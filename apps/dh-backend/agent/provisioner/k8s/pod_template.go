package k8s

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	"k8s.io/apimachinery/pkg/util/intstr"

	"github.com/deepharness/deepharness-ent-platform/apps/dh-backend/config"
)

// 常量：Pod 内容器名、卷名等。
const (
	containerName     = "gatewayd"
	volumeNameWorkspace = "workspace"
	envMode            = "MODE"
	envModeWarm        = "warm"
	envModeUser        = "user"
)

// buildResourceRequirements 将 ProvisionerResourceSpec 转换为 K8s ResourceRequirements。
func buildResourceRequirements(spec config.ProvisionerResourceSpec) corev1.ResourceRequirements {
	req := corev1.ResourceList{}
	if spec.CPURequest != "" {
		req[corev1.ResourceCPU] = mustParseQuantity(spec.CPURequest)
	}
	if spec.MemoryRequest != "" {
		req[corev1.ResourceMemory] = mustParseQuantity(spec.MemoryRequest)
	}
	lim := corev1.ResourceList{}
	if spec.CPULimit != "" {
		lim[corev1.ResourceCPU] = mustParseQuantity(spec.CPULimit)
	}
	if spec.MemoryLimit != "" {
		lim[corev1.ResourceMemory] = mustParseQuantity(spec.MemoryLimit)
	}
	return corev1.ResourceRequirements{
		Requests: req,
		Limits:   lim,
	}
}

// BuildWarmPoolPod 构建暖池 Pod 对象（未绑定用户，MODE=warm）。
func BuildWarmPoolPod(name string, cfg config.ProvisionerConfig) *corev1.Pod {
	labels := baseLabels()
	labels[LabelType] = LabelTypeWarmPool
	labels[LabelStatus] = LabelStatusUnbound

	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: cfg.Namespace,
			Labels:    labels,
		},
		Spec: buildPodSpec(cfg, envModeWarm, nil, cfg.ResourceActive),
	}
}

// BuildUserPod 构建已绑定用户的 Pod 对象。
func BuildUserPod(name, workspaceID, userID string, cfg config.ProvisionerConfig, extraEnv []corev1.EnvVar) *corev1.Pod {
	labels := baseLabels()
	labels[LabelType] = LabelTypeUser
	labels[LabelWorkspaceID] = workspaceID
	labels[LabelUserID] = userID
	labels[LabelStatus] = LabelStatusActive

	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: cfg.Namespace,
			Labels:    labels,
		},
		Spec: buildPodSpec(cfg, envModeUser, extraEnv, cfg.ResourceActive),
	}
}

// baseLabels 返回所有 Pod 共有的 label 集合。
func baseLabels() map[string]string {
	return map[string]string{
		LabelManagedBy: LabelValueManagedBy,
	}
}

// buildPodSpec 构建 Pod Spec，包含 gatewayd 容器、共享卷挂载和就绪探针。
func buildPodSpec(cfg config.ProvisionerConfig, mode string, extraEnv []corev1.EnvVar, resSpec config.ProvisionerResourceSpec) corev1.PodSpec {
	agentPort := int32(cfg.AgentPort)
	if agentPort == 0 {
		agentPort = defaultAgentPort
	}
	adminPort := int32(cfg.AdminPort)
	if adminPort == 0 {
		adminPort = defaultAdminPort
	}

	mountPath := cfg.WorkspaceMountPath
	if mountPath == "" {
		mountPath = defaultWorkspaceMountPath
	}

	env := []corev1.EnvVar{
		{Name: envMode, Value: mode},
	}
	env = append(env, extraEnv...)

	return corev1.PodSpec{
		Containers: []corev1.Container{{
			Name:  containerName,
			Image: cfg.Image,
			Ports: []corev1.ContainerPort{
				{Name: "agent", ContainerPort: agentPort, Protocol: corev1.ProtocolTCP},
				{Name: "admin", ContainerPort: adminPort, Protocol: corev1.ProtocolTCP},
			},
			Env:    env,
			Resources: buildResourceRequirements(resSpec),
			VolumeMounts: []corev1.VolumeMount{
				{Name: volumeNameWorkspace, MountPath: mountPath},
			},
			ReadinessProbe: &corev1.Probe{
				ProbeHandler: corev1.ProbeHandler{
					HTTPGet: &corev1.HTTPGetAction{
						Path: "/admin/health",
						Port: intstr.FromInt32(adminPort),
					},
				},
				InitialDelaySeconds: 3,
				PeriodSeconds:       5,
				FailureThreshold:    6,
			},
		}},
		Volumes: []corev1.Volume{{
			Name: volumeNameWorkspace,
			VolumeSource: corev1.VolumeSource{
				PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
					ClaimName: cfg.SharedPVCName,
				},
			},
		}},
	}
}

// defaultAgentPort gatewayd agent API 默认端口。
const defaultAgentPort = 2345

// defaultAdminPort gatewayd admin API 默认端口。
const defaultAdminPort = 2346

// defaultWorkspaceMountPath 共享卷默认挂载路径。
const defaultWorkspaceMountPath = "/workspace"

// mustParseQuantity 解析资源配额字符串，解析失败时 panic（配置应在启动时校验）。
func mustParseQuantity(s string) resource.Quantity {
	q, err := resource.ParseQuantity(s)
	if err != nil {
		panic(fmt.Sprintf("invalid resource quantity %q: %v", s, err))
	}
	return q
}
