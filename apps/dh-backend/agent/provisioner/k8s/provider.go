package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"

	"github.com/google/uuid"

	agent "github.com/deepharness/deepharness-ent-platform/packages/go-sdk/domain/agent"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)

// provisioning 超时与轮询间隔常量。
const (
	podReadyTimeout     = 120 * time.Second
	podReadyPollInterval = 2 * time.Second
	podNamePrefix        = "gw-"
)

// AdminClient 容器管理 API 的最小依赖接口，避免与 provisioner 包形成循环引用。
// 管理面调用通过 personal-stub 代理到 gatewayd。
type AdminClient interface {
	Health(ctx context.Context, containerURL string) (*HealthResponse, error)
	Bind(ctx context.Context, containerURL string, req BindRequest) error
	Sleep(ctx context.Context, containerURL string) error
	Wake(ctx context.Context, containerURL string) error
}

// HealthResponse personal-stub /api/v1/container/health 响应。
type HealthResponse struct {
	Status string `json:"status"`
}

// BindRequest personal-stub /api/v1/container/bind 请求体。
type BindRequest struct {
	WorkspaceID   string   `json:"workspaceId"`
	UserID        string   `json:"userId"`
	WorkspacePath string   `json:"workspacePath"`
	Roles         []string `json:"roles"`
	AgentType     string   `json:"agentType"`
}

// ProviderName 供给器类型名称。
const ProviderName = "k8s"

// Provider 基于 K8s 原生 API 的 Agent 实例供给器。
// 通过直接操作 Pod 资源实现暖池、绑定、休眠/唤醒、驱逐等生命周期管理。
type Provider struct {
	clientset   *kubernetes.Clientset
	adminClient AdminClient
	cfg         config.ProvisionerConfig
}

// New 创建 K8sProvider。
// kubeconfigPath 为空时使用 in-cluster config；非空时加载指定 kubeconfig 文件。
// adminClient 用于调用 gatewayd 的 Admin API（bind/sleep/wake/health）。
func New(cfg config.ProvisionerConfig, adminClient AdminClient) (*Provider, error) {
	var restCfg *rest.Config
	var err error

	if cfg.K8s.Namespace == "" {
		return nil, fmt.Errorf("k8s provisioner requires namespace")
	}
	if cfg.K8s.Image == "" {
		return nil, fmt.Errorf("k8s provisioner requires image")
	}

	if cfg.K8s.KubeconfigPath != "" {
		restCfg, err = clientcmd.BuildConfigFromFlags("", cfg.K8s.KubeconfigPath)
	} else {
		restCfg, err = rest.InClusterConfig()
	}
	if err != nil {
		return nil, fmt.Errorf("build k8s rest config failed: %w", err)
	}

	clientset, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		return nil, fmt.Errorf("create k8s clientset failed: %w", err)
	}

	return &Provider{
		clientset:   clientset,
		adminClient: adminClient,
		cfg:         cfg,
	}, nil
}

// Name 返回供给器类型名称。
func (p *Provider) Name() string {
	return ProviderName
}

// Provision 为用户分配 Agent 实例。
// 优先级：已绑定且活跃 > 已绑定且休眠 > 暖池分配 > 冷启动创建。
func (p *Provider) Provision(ctx context.Context, req agent.ProvisionRequest) (agent.ProvisionResult, error) {
	// 1. 查找已有实例（活跃或休眠）
	existing, err := p.FindByUser(ctx, req.WorkspaceID, req.UserID)
	if err != nil {
		return agent.ProvisionResult{}, fmt.Errorf("find existing instance failed: %w", err)
	}
	if existing != nil {
		switch existing.Status {
		case agent.InstanceStatusActive:
			return agent.ProvisionResult{
				Instance: *existing,
				Stage:    "ready",
			}, nil
		case agent.InstanceStatusSleeping:
			result, err := p.Wake(ctx, existing.InstanceID)
			if err != nil {
				return agent.ProvisionResult{}, fmt.Errorf("wake instance %s failed: %w", existing.InstanceID, err)
			}
			return agent.ProvisionResult{
				Instance:     result,
				Stage:        "waking",
				EstimatedSec: 5,
			}, nil
		}
	}

	// 2. 尝试从暖池分配
	warmPod, err := p.findUnboundWarmPod(ctx)
	if err != nil {
		return agent.ProvisionResult{}, fmt.Errorf("find warm pool pod failed: %w", err)
	}
	if warmPod != nil {
		return p.bindWarmPod(ctx, warmPod, req)
	}

	// 3. 冷启动：创建新 Pod
	return p.createUserPod(ctx, req)
}

// Sleep 休眠实例：通过 personal-stub 管理面调用容器休眠或降低资源配额（降级模式）。
func (p *Provider) Sleep(ctx context.Context, instanceID string) error {
	pod, err := p.getPod(ctx, instanceID)
	if err != nil {
		return err
	}

	containerURL := p.podStubURL(pod)

	if p.cfg.K8s.SupportsBind {
		if err := p.adminClient.Sleep(ctx, containerURL); err != nil {
			log.Printf("[K8sProvider] container sleep failed for %s, degrading to resource scale-down: %v", instanceID, err)
		}
	} else {
		log.Printf("[K8sProvider] SupportsBind=false, scaling down resources for %s", instanceID)
	}

	// 降低资源配额到休眠级别
	if err := p.patchPodResources(ctx, pod, p.cfg.K8s.ResourceSleeping); err != nil {
		return fmt.Errorf("patch pod resources to sleeping failed: %w", err)
	}

	// 更新 label 为 sleeping
	annotations := map[string]string{
		AnnotationSleepStartedAt: time.Now().UTC().Format(time.RFC3339),
	}
	if err := p.patchPodLabels(ctx, instanceID, map[string]string{LabelStatus: LabelStatusSleeping}, annotations); err != nil {
		return fmt.Errorf("patch pod labels to sleeping failed: %w", err)
	}

	return nil
}

// Wake 唤醒已休眠的实例。
func (p *Provider) Wake(ctx context.Context, instanceID string) (agent.AgentInstance, error) {
	pod, err := p.getPod(ctx, instanceID)
	if err != nil {
		return agent.AgentInstance{}, err
	}

	containerURL := p.podStubURL(pod)

	if p.cfg.K8s.SupportsBind {
		if err := p.adminClient.Wake(ctx, containerURL); err != nil {
			log.Printf("[K8sProvider] container wake failed for %s, degrading to resource scale-up: %v", instanceID, err)
		}
	}

	// 恢复资源配额到活跃级别
	if err := p.patchPodResources(ctx, pod, p.cfg.K8s.ResourceActive); err != nil {
		return agent.AgentInstance{}, fmt.Errorf("patch pod resources to active failed: %w", err)
	}

	// 更新 label 为 active
	if err := p.patchPodLabels(ctx, instanceID, map[string]string{LabelStatus: LabelStatusActive}, nil); err != nil {
		return agent.AgentInstance{}, fmt.Errorf("patch pod labels to active failed: %w", err)
	}

	// 等待 Pod 就绪
	if err := p.waitPodReady(ctx, instanceID); err != nil {
		return agent.AgentInstance{}, fmt.Errorf("wait pod ready after wake failed: %w", err)
	}

	// 重新获取 Pod 以获取最新 IP
	pod, err = p.getPod(ctx, instanceID)
	if err != nil {
		return agent.AgentInstance{}, err
	}

	return p.podToInstance(pod, agent.InstanceStatusActive), nil
}

// Destroy 销毁实例：删除 Pod（保留 PVC）。
func (p *Provider) Destroy(ctx context.Context, instanceID string) error {
	err := p.clientset.CoreV1().Pods(p.cfg.K8s.Namespace).Delete(ctx, instanceID, metav1.DeleteOptions{})
	if err != nil && !apierrors.IsNotFound(err) {
		return fmt.Errorf("delete pod %s failed: %w", instanceID, err)
	}
	return nil
}

// Status 查询实例状态。
func (p *Provider) Status(ctx context.Context, instanceID string) (agent.InstanceStatus, error) {
	pod, err := p.getPod(ctx, instanceID)
	if err != nil {
		return "", err
	}
	return p.podStatusLabel(pod), nil
}

// FindByUser 按 workspaceID + userID 查找已有 Pod。
func (p *Provider) FindByUser(ctx context.Context, workspaceID, userID string) (*agent.AgentInstance, error) {
	pods, err := p.clientset.CoreV1().Pods(p.cfg.K8s.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: SelectorByUser(workspaceID, userID),
	})
	if err != nil {
		return nil, fmt.Errorf("list pods for user failed: %w", err)
	}
	if len(pods.Items) == 0 {
		return nil, nil
	}

	pod := &pods.Items[0]
	status := p.podStatusLabel(pod)
	if status == "" {
		return nil, nil
	}

	inst := p.podToInstance(pod, status)
	return &inst, nil
}

// WarmPoolEnsure 确保暖池中有至少 min 个可用（unbound）Pod。
func (p *Provider) WarmPoolEnsure(ctx context.Context, min int) error {
	if min <= 0 {
		return nil
	}

	pods, err := p.clientset.CoreV1().Pods(p.cfg.K8s.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: SelectorWarmPool(),
	})
	if err != nil {
		return fmt.Errorf("list warm pool pods failed: %w", err)
	}

	available := 0
	for i := range pods.Items {
		if p.podStatusLabel(&pods.Items[i]) == agent.InstanceStatusUnbound {
			available++
		}
	}

	needed := min - available
	for i := 0; i < needed; i++ {
		name := generatePodName()
		pod := BuildWarmPoolPod(name, p.cfg.K8s)
		if _, err := p.clientset.CoreV1().Pods(p.cfg.K8s.Namespace).Create(ctx, pod, metav1.CreateOptions{}); err != nil {
			log.Printf("[K8sProvider] create warm pool pod %s failed: %v", name, err)
			continue
		}
		log.Printf("[K8sProvider] created warm pool pod %s", name)
	}

	return nil
}

// WarmPoolStatus 查询暖池状态。
func (p *Provider) WarmPoolStatus(ctx context.Context) (agent.WarmPoolStatus, error) {
	pods, err := p.clientset.CoreV1().Pods(p.cfg.K8s.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: SelectorWarmPool(),
	})
	if err != nil {
		return agent.WarmPoolStatus{}, fmt.Errorf("list warm pool pods failed: %w", err)
	}

	available := 0
	for i := range pods.Items {
		if p.podStatusLabel(&pods.Items[i]) == agent.InstanceStatusUnbound {
			available++
		}
	}

	return agent.WarmPoolStatus{
		Available: available,
		Total:     len(pods.Items),
		Min:       p.cfg.WarmPoolMin,
		Max:       p.cfg.WarmPoolMax,
	}, nil
}

// --- 内部方法 ---

// findUnboundWarmPod 查找一个可用的暖池 Pod。
func (p *Provider) findUnboundWarmPod(ctx context.Context) (*corev1.Pod, error) {
	pods, err := p.clientset.CoreV1().Pods(p.cfg.K8s.Namespace).List(ctx, metav1.ListOptions{
		LabelSelector: SelectorWarmPool(),
	})
	if err != nil {
		return nil, err
	}
	for i := range pods.Items {
		pod := &pods.Items[i]
		if p.podStatusLabel(pod) == agent.InstanceStatusUnbound && p.isPodReady(pod) {
			return pod, nil
		}
	}
	return nil, nil
}

// bindWarmPod 将暖池 Pod 绑定到用户。
// SupportsBind=true 时通过 personal-stub 管理面调用容器绑定；否则通过环境变量注入用户上下文后重建 Pod。
func (p *Provider) bindWarmPod(ctx context.Context, pod *corev1.Pod, req agent.ProvisionRequest) (agent.ProvisionResult, error) {
	instanceID := pod.Name

	if p.cfg.K8s.SupportsBind {
		containerURL := p.podStubURL(pod)
		err := p.adminClient.Bind(ctx, containerURL, BindRequest{
			WorkspaceID: req.WorkspaceID,
			UserID:      req.UserID,
			Roles:       req.Roles,
			AgentType:   req.AgentType,
		})
		if err != nil {
			return agent.ProvisionResult{}, fmt.Errorf("container bind failed for %s: %w", instanceID, err)
		}
	}

	// 更新 label：type=user, workspace-id, user-id, status=active
	newLabels := map[string]string{
		LabelType:        LabelTypeUser,
		LabelWorkspaceID: req.WorkspaceID,
		LabelUserID:      req.UserID,
		LabelStatus:      LabelStatusActive,
	}
	if err := p.patchPodLabels(ctx, instanceID, newLabels, nil); err != nil {
		return agent.ProvisionResult{}, fmt.Errorf("patch pod labels for bind failed: %w", err)
	}

	// 等待就绪
	if err := p.waitPodReady(ctx, instanceID); err != nil {
		return agent.ProvisionResult{}, fmt.Errorf("wait pod ready after bind failed: %w", err)
	}

	updated, err := p.getPod(ctx, instanceID)
	if err != nil {
		return agent.ProvisionResult{}, err
	}

	inst := p.podToInstance(updated, agent.InstanceStatusActive)
	return agent.ProvisionResult{
		Instance:     inst,
		Stage:        "assigning",
		EstimatedSec: 3,
	}, nil
}

// createUserPod 冷启动创建新的用户 Pod。
func (p *Provider) createUserPod(ctx context.Context, req agent.ProvisionRequest) (agent.ProvisionResult, error) {
	name := generatePodName()
	pod := BuildUserPod(name, req.WorkspaceID, req.UserID, p.cfg.K8s, nil)

	if _, err := p.clientset.CoreV1().Pods(p.cfg.K8s.Namespace).Create(ctx, pod, metav1.CreateOptions{}); err != nil {
		return agent.ProvisionResult{}, fmt.Errorf("create user pod %s failed: %w", name, err)
	}

	log.Printf("[K8sProvider] created user pod %s for ws=%s user=%s", name, req.WorkspaceID, req.UserID)

	if p.cfg.K8s.SupportsBind {
		// 等待 Pod 就绪后通过 personal-stub 管理面调用 bind
		if err := p.waitPodReady(ctx, name); err != nil {
			return agent.ProvisionResult{}, fmt.Errorf("wait pod ready for bind failed: %w", err)
		}
		updated, err := p.getPod(ctx, name)
		if err != nil {
			return agent.ProvisionResult{}, err
		}
		containerURL := p.podStubURL(updated)
		if err := p.adminClient.Bind(ctx, containerURL, BindRequest{
			WorkspaceID: req.WorkspaceID,
			UserID:      req.UserID,
			Roles:       req.Roles,
			AgentType:   req.AgentType,
		}); err != nil {
			log.Printf("[K8sProvider] container bind failed for %s, continuing with env-based config: %v", name, err)
		}
	} else {
		// 降级模式：等待 Pod 就绪即可
		if err := p.waitPodReady(ctx, name); err != nil {
			return agent.ProvisionResult{}, fmt.Errorf("wait pod ready failed: %w", err)
		}
	}

	updated, err := p.getPod(ctx, name)
	if err != nil {
		return agent.ProvisionResult{}, err
	}

	inst := p.podToInstance(updated, agent.InstanceStatusActive)
	return agent.ProvisionResult{
		Instance:     inst,
		Stage:        "creating",
		EstimatedSec: 15,
	}, nil
}

// getPod 获取指定 Pod。
func (p *Provider) getPod(ctx context.Context, name string) (*corev1.Pod, error) {
	pod, err := p.clientset.CoreV1().Pods(p.cfg.K8s.Namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		if apierrors.IsNotFound(err) {
			return nil, fmt.Errorf("pod %s not found", name)
		}
		return nil, fmt.Errorf("get pod %s failed: %w", name, err)
	}
	return pod, nil
}

// waitPodReady 轮询等待 Pod 的 readinessProbe 通过。
func (p *Provider) waitPodReady(ctx context.Context, name string) error {
	deadline := time.Now().Add(podReadyTimeout)
	for time.Now().Before(deadline) {
		pod, err := p.getPod(ctx, name)
		if err != nil {
			return err
		}
		if p.isPodReady(pod) {
			return nil
		}
		if pod.Status.Phase == corev1.PodFailed {
			return fmt.Errorf("pod %s entered Failed phase", name)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(podReadyPollInterval):
		}
	}
	return fmt.Errorf("pod %s not ready within %s", name, podReadyTimeout)
}

// isPodReady 判断 Pod 是否已通过 readinessProbe。
func (p *Provider) isPodReady(pod *corev1.Pod) bool {
	for _, cond := range pod.Status.Conditions {
		if cond.Type == corev1.PodReady && cond.Status == corev1.ConditionTrue {
			return true
		}
	}
	return false
}

// patchPodLabels 通过 JSON merge patch 更新 Pod 的 label 和 annotation。
func (p *Provider) patchPodLabels(ctx context.Context, name string, labels, annotations map[string]string) error {
	if len(labels) == 0 && len(annotations) == 0 {
		return nil
	}
	patch := map[string]interface{}{}
	if len(labels) > 0 {
		patch["metadata"] = map[string]interface{}{
			"labels": labels,
		}
	}
	if len(annotations) > 0 {
		meta, ok := patch["metadata"].(map[string]interface{})
		if !ok {
			meta = map[string]interface{}{}
		}
		meta["annotations"] = annotations
		patch["metadata"] = meta
	}

	data, err := json.Marshal(patch)
	if err != nil {
		return fmt.Errorf("marshal patch failed: %w", err)
	}

	_, err = p.clientset.CoreV1().Pods(p.cfg.K8s.Namespace).Patch(ctx, name, types.MergePatchType, data, metav1.PatchOptions{})
	return err
}

// patchPodResources 通过 strategic merge patch 更新容器资源配额。
func (p *Provider) patchPodResources(ctx context.Context, pod *corev1.Pod, res config.ProvisionerResourceSpec) error {
	resources := buildResourceRequirements(res)
	patch := map[string]interface{}{
		"spec": map[string]interface{}{
			"containers": []map[string]interface{}{{
				"name":      containerName,
				"resources": resources,
			}},
		},
	}

	data, err := json.Marshal(patch)
	if err != nil {
		return fmt.Errorf("marshal resource patch failed: %w", err)
	}

	_, err = p.clientset.CoreV1().Pods(p.cfg.K8s.Namespace).Patch(ctx, pod.Name, types.StrategicMergePatchType, data, metav1.PatchOptions{})
	return err
}

// podAdminURL 构建 Pod 的 gatewayd admin API 地址（http://{podIP}:{adminPort}）。
// 用于会话面直连（session/chat/events）。
func (p *Provider) podAdminURL(pod *corev1.Pod) string {
	port := p.cfg.K8s.AdminPort
	if port == 0 {
		port = defaultAdminPort
	}
	return fmt.Sprintf("http://%s:%d", pod.Status.PodIP, port)
}

// podStubURL 构建 Pod 的 personal-stub 管理面地址（http://{podIP}:{stubPort}）。
// 用于管理面调用（健康/绑定/休眠/唤醒），personal-stub 内部代理到 gatewayd。
func (p *Provider) podStubURL(pod *corev1.Pod) string {
	port := p.cfg.K8s.StubPort
	if port == 0 {
		port = defaultStubPort
	}
	return fmt.Sprintf("http://%s:%d", pod.Status.PodIP, port)
}

// podAgentURL 构建 Pod 的 agent API 地址（http://{podIP}:{agentPort}）。
func (p *Provider) podAgentURL(pod *corev1.Pod) string {
	port := p.cfg.K8s.AgentPort
	if port == 0 {
		port = defaultAgentPort
	}
	return fmt.Sprintf("http://%s:%d", pod.Status.PodIP, port)
}

// podStatusLabel 从 Pod 的 label 推断 AgentInstance 状态。
func (p *Provider) podStatusLabel(pod *corev1.Pod) agent.InstanceStatus {
	status := pod.Labels[LabelStatus]
	switch status {
	case LabelStatusActive:
		return agent.InstanceStatusActive
	case LabelStatusSleeping:
		return agent.InstanceStatusSleeping
	case LabelStatusUnbound:
		return agent.InstanceStatusUnbound
	default:
		return agent.InstanceStatusCreating
	}
}

// podToInstance 将 K8s Pod 对象转换为 AgentInstance。
func (p *Provider) podToInstance(pod *corev1.Pod, status agent.InstanceStatus) agent.AgentInstance {
	return agent.AgentInstance{
		InstanceID: pod.Name,
		AdminURL:   p.podAdminURL(pod),
		AgentURL:   p.podAgentURL(pod),
		Status:     status,
		AssignedAt: time.Now(),
	}
}

// generatePodName 生成唯一的 Pod 名称。
func generatePodName() string {
	return podNamePrefix + uuid.NewString()[:8]
}
