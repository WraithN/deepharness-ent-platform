package k8s

// K8s label / annotation 常量，用于 gatewayd Pod 的选择与过滤。
const (
	// LabelManagedBy 标识资源由谁管理。
	LabelManagedBy = "deepharness.io/managed-by"
	// LabelValueManagedBy managed-by 的固定值。
	LabelValueManagedBy = "dh-backend"

	// LabelType 区分暖池 Pod 与用户 Pod。
	LabelType = "deepharness.io/type"
	// LabelTypeWarmPool 暖池中未绑定用户的 Pod。
	LabelTypeWarmPool = "warm-pool"
	// LabelTypeUser 已绑定用户的 Pod。
	LabelTypeUser = "user"

	// LabelWorkspaceID 绑定的工作空间 ID（仅用户 Pod 有）。
	LabelWorkspaceID = "deepharness.io/workspace-id"
	// LabelUserID 绑定的用户 ID（仅用户 Pod 有）。
	LabelUserID = "deepharness.io/user-id"

	// LabelStatus Pod 生命周期状态。
	LabelStatus = "deepharness.io/status"
	// LabelStatusUnbound 暖池中待分配。
	LabelStatusUnbound = "unbound"
	// LabelStatusActive 已绑定用户，正在服务。
	LabelStatusActive = "active"
	// LabelStatusSleeping 休眠中（agent 进程已停止或资源已降配）。
	LabelStatusSleeping = "sleeping"

	// AnnotationSleepStartedAt 休眠开始时间（RFC3339），用于驱逐排序。
	AnnotationSleepStartedAt = "deepharness.io/sleep-started-at"
)

// SelectorWarmPool 构建暖池 Pod 的 label selector 字符串。
func SelectorWarmPool() string {
	return LabelManagedBy + "=" + LabelValueManagedBy +
		"," + LabelType + "=" + LabelTypeWarmPool +
		"," + LabelStatus + "=" + LabelStatusUnbound
}

// SelectorByUser 构建按 workspace+user 查找 Pod 的 label selector 字符串。
func SelectorByUser(workspaceID, userID string) string {
	return LabelManagedBy + "=" + LabelValueManagedBy +
		"," + LabelType + "=" + LabelTypeUser +
		"," + LabelWorkspaceID + "=" + workspaceID +
		"," + LabelUserID + "=" + userID
}

// SelectorAllManaged 构建所有由 dh-backend 管理的 Pod 的 label selector。
func SelectorAllManaged() string {
	return LabelManagedBy + "=" + LabelValueManagedBy
}
