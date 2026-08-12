package repository

import (
	"context"
	"strconv"
	"strings"
)

// buildArchGraph 从架构库 YAML 元数据构建三视图架构图（工程全景/服务依赖/业务领域）。
// 返回 (views, 业务线选项, warnings)；单个文件缺失或解析失败不阻断整体出图。
func buildArchGraph(ctx context.Context, repoPath string) (map[string]*archView, []archDomainOption, []string) {
	domains, warn1 := loadArchDomains(ctx, repoPath)
	services, warn2 := loadArchServices(ctx, repoPath)
	rules, warn3 := loadArchDomainRules(ctx, repoPath)
	warnings := append(append(warn1, warn2...), warn3...)

	serviceByKey := make(map[string]archServiceDef, len(services))
	for _, svc := range services {
		serviceByKey[svc.ServiceKey] = svc
	}
	domainNameByKey := make(map[string]string, len(domains))
	for _, d := range domains {
		domainNameByKey[d.DomainKey] = d.DomainName
	}

	views := map[string]*archView{
		archProjectView: buildRepoLevelView(services, serviceByKey, domainNameByKey),
		archServiceView: buildServiceLevelView(services, serviceByKey, domainNameByKey),
		archDDDView:     buildDomainLevelView(domains, services, serviceByKey, rules),
	}
	options := make([]archDomainOption, 0, len(domains))
	for _, d := range domains {
		options = append(options, archDomainOption{Key: d.DomainKey, Name: d.DomainName})
	}
	return views, options, warnings
}

// buildRepoLevelView 工程全景（仓库维度）：节点为服务对应的工程仓库，边为 RPC/MQ/DB 依赖。
func buildRepoLevelView(services []archServiceDef, serviceByKey map[string]archServiceDef, domainNameByKey map[string]string) *archView {
	view := &archView{}
	for _, svc := range services {
		kind := archNodeKindRepo
		if isInfraService(svc, domainNameByKey) {
			kind = archNodeKindInfra
		}
		view.Nodes = append(view.Nodes, archNode{
			ID:           svc.ServiceKey,
			Label:        svc.ServiceKey,
			Kind:         kind,
			BusinessLine: domainNameByKey[svc.Domain],
			Meta: map[string]string{
				"服务名":  svc.ServiceName,
				"业务线":  domainNameByKey[svc.Domain],
				"负责团队": svc.OwnerTeam,
				"服务等级": svc.ServiceLevel,
				"能力数":  strconv.Itoa(len(svc.Capabilities)),
				"描述":   svc.Description,
			},
		})
	}
	view.Edges = buildServiceEdges(services, serviceByKey)
	return view
}

// buildServiceLevelView 服务依赖视图（微服务）：与工程全景同拓扑，节点呈现微服务属性。
func buildServiceLevelView(services []archServiceDef, serviceByKey map[string]archServiceDef, domainNameByKey map[string]string) *archView {
	view := &archView{}
	for _, svc := range services {
		kind := archNodeKindService
		if isInfraService(svc, domainNameByKey) {
			kind = archNodeKindInfra
		}
		view.Nodes = append(view.Nodes, archNode{
			ID:           svc.ServiceKey,
			Label:        svc.ServiceName,
			Kind:         kind,
			BusinessLine: domainNameByKey[svc.Domain],
			Meta: map[string]string{
				"服务标识":    svc.ServiceKey,
				"业务线":     domainNameByKey[svc.Domain],
				"服务等级":    svc.ServiceLevel,
				"自有库":     svc.Database.OwnDB,
				"对外依赖":    strconv.Itoa(len(svc.Dependencies.SyncCall)),
				"生产Topic": strconv.Itoa(len(svc.Dependencies.AsyncProduce)),
				"消费Topic": strconv.Itoa(len(svc.Dependencies.AsyncConsume)),
			},
		})
	}
	view.Edges = buildServiceEdges(services, serviceByKey)
	return view
}

// buildServiceEdges 汇总服务间依赖边：syncCall→RPC，同 topic 的生产者→消费者→MQ，跨服务读库→DB共享。
// 指向未登记服务的依赖跳过（架构库数据不全时不产生悬空边）。
func buildServiceEdges(services []archServiceDef, serviceByKey map[string]archServiceDef) []archEdge {
	var edges []archEdge
	topicConsumers := map[string][]string{} // topicKey -> consumer serviceKeys
	for _, svc := range services {
		for _, dep := range svc.Dependencies.AsyncConsume {
			topicConsumers[dep.TopicKey] = append(topicConsumers[dep.TopicKey], svc.ServiceKey)
		}
	}
	// mqEdge 去重：同一对 生产者->消费者->topic 只出一条边。
	mqSeen := map[string]bool{}
	dbSeen := map[string]bool{}
	for _, svc := range services {
		for _, dep := range svc.Dependencies.SyncCall {
			if _, ok := serviceByKey[dep.TargetService]; !ok {
				continue
			}
			edges = append(edges, archEdge{Source: svc.ServiceKey, Target: dep.TargetService, Label: "RPC调用", Kind: archEdgeKindRPC})
		}
		for _, dep := range svc.Dependencies.AsyncProduce {
			for _, consumer := range topicConsumers[dep.TopicKey] {
				key := svc.ServiceKey + "|" + consumer + "|" + dep.TopicKey
				if mqSeen[key] {
					continue
				}
				mqSeen[key] = true
				edges = append(edges, archEdge{Source: svc.ServiceKey, Target: consumer, Label: "MQ:" + dep.TopicKey, Kind: archEdgeKindMQ})
			}
		}
		edges = append(edges, buildDBShareEdges(svc, serviceByKey, dbSeen)...)
	}
	return edges
}

// buildDBShareEdges 服务读了他服务的自有库时产生 DB共享 边（svc -> 库属主）。
func buildDBShareEdges(svc archServiceDef, serviceByKey map[string]archServiceDef, seen map[string]bool) []archEdge {
	var edges []archEdge
	for _, db := range svc.Database.AllowedReadDB {
		for _, other := range serviceByKey {
			if other.ServiceKey == svc.ServiceKey || other.Database.OwnDB != db {
				continue
			}
			key := svc.ServiceKey + "|" + other.ServiceKey + "|" + db
			if seen[key] {
				continue
			}
			seen[key] = true
			edges = append(edges, archEdge{Source: svc.ServiceKey, Target: other.ServiceKey, Label: "DB共享:" + db, Kind: archEdgeKindDB})
		}
	}
	return edges
}

// buildDomainLevelView 业务领域视图（DDD）：节点为领域；
// 边优先取 rules/ 依赖矩阵，否则把服务级 syncCall 聚合到领域维度。
func buildDomainLevelView(domains []archDomainDef, services []archServiceDef, serviceByKey map[string]archServiceDef, rules *archDomainRules) *archView {
	view := &archView{}
	domainKeys := map[string]bool{}
	for _, d := range domains {
		domainKeys[d.DomainKey] = true
		view.Nodes = append(view.Nodes, archNode{
			ID:           d.DomainKey,
			Label:        d.DomainName,
			Kind:         archNodeKindDomain,
			BusinessLine: d.DomainName,
			Meta: map[string]string{
				"聚合根":  strings.Join(d.AggregateRoots, "、"),
				"负责团队": d.OwnerTeam,
				"职责":   d.Description,
			},
		})
	}
	if rules != nil && len(rules.Matrix) > 0 {
		view.Edges = buildDomainRuleEdges(rules, domainKeys)
		return view
	}
	view.Edges = aggregateServiceEdgesToDomain(services, serviceByKey, domainKeys)
	return view
}

// buildDomainRuleEdges 按 rules 依赖矩阵生成领域间允许调用边。
// 注：allowEventSubscribe 指向的是 topic 而非领域，无对应节点，暂不单独成边。
func buildDomainRuleEdges(rules *archDomainRules, domainKeys map[string]bool) []archEdge {
	var edges []archEdge
	for domain, constraint := range rules.Matrix {
		if !domainKeys[domain] {
			continue
		}
		for _, target := range constraint.AllowSyncCall {
			if domainKeys[target] {
				edges = append(edges, archEdge{Source: domain, Target: target, Label: "允许同步调用", Kind: archEdgeKindRPC})
			}
		}
	}
	return edges
}

// aggregateServiceEdgesToDomain 把服务级 syncCall 聚合为领域间依赖边（去重）。
func aggregateServiceEdgesToDomain(services []archServiceDef, serviceByKey map[string]archServiceDef, domainKeys map[string]bool) []archEdge {
	var edges []archEdge
	seen := map[string]bool{}
	for _, svc := range services {
		for _, dep := range svc.Dependencies.SyncCall {
			target, ok := serviceByKey[dep.TargetService]
			if !ok || svc.Domain == "" || target.Domain == "" || svc.Domain == target.Domain {
				continue
			}
			if !domainKeys[svc.Domain] || !domainKeys[target.Domain] {
				continue
			}
			key := svc.Domain + "|" + target.Domain
			if seen[key] {
				continue
			}
			seen[key] = true
			edges = append(edges, archEdge{Source: svc.Domain, Target: target.Domain, Label: "RPC调用", Kind: archEdgeKindRPC})
		}
	}
	return edges
}

// isInfraService 判定服务是否为基础组件（tags 命中或所属领域名含「基础」）。
func isInfraService(svc archServiceDef, domainNameByKey map[string]string) bool {
	for _, tag := range svc.Tags {
		for _, infra := range infraTags {
			if strings.EqualFold(tag, infra) {
				return true
			}
		}
	}
	return strings.Contains(domainNameByKey[svc.Domain], "基础")
}
