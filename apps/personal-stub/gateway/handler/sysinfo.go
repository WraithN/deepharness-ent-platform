package handler

import (
	"log"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// sysinfoCollectInterval 是后台采集系统指标的间隔。
const sysinfoCollectInterval = 5 * time.Second

// sysInfoCache 缓存最新的 CPU/内存指标，避免每次上报都读取 /proc。
var sysInfoCache struct {
	mu        sync.RWMutex
	cpuPercent float64
	memPercent float64
	updatedAt  time.Time
}

// sysInfoStarted 确保后台采集 goroutine 只启动一次。
var sysInfoStarted sync.Once

// StartSysInfoCollector 启动后台 goroutine 定期采集 CPU/内存使用率。
// 采集结果缓存到 sysInfoCache，供 ContainerReport 读取。
func StartSysInfoCollector() {
	sysInfoStarted.Do(func() {
		go sysInfoCollectLoop()
		log.Println("[PersonalStub] sysinfo collector started")
	})
}

// sysInfoCollectLoop 周期性采集 CPU/内存指标。
func sysInfoCollectLoop() {
	// 首次立即采集
	collectSysInfo()
	ticker := time.NewTicker(sysinfoCollectInterval)
	defer ticker.Stop()
	for range ticker.C {
		collectSysInfo()
	}
}

// collectSysInfo 采集一次 CPU/内存使用率并更新缓存。
func collectSysInfo() {
	cpu, mem := readCPUUsage(), readMemUsage()
	sysInfoCache.mu.Lock()
	sysInfoCache.cpuPercent = cpu
	sysInfoCache.memPercent = mem
	sysInfoCache.updatedAt = time.Now()
	sysInfoCache.mu.Unlock()
}

// GetCPUPercent 返回缓存中的 CPU 使用率（0-100）。
func GetCPUPercent() float64 {
	sysInfoCache.mu.RLock()
	defer sysInfoCache.mu.RUnlock()
	return sysInfoCache.cpuPercent
}

// GetMemPercent 返回缓存中的内存使用率（0-100）。
func GetMemPercent() float64 {
	sysInfoCache.mu.RLock()
	defer sysInfoCache.mu.RUnlock()
	return sysInfoCache.memPercent
}

// readCPUUsage 通过两次采样 /proc/stat 计算整机 CPU 使用率。
// 采样间隔为 200ms，适用于 Linux 环境；非 Linux 环境返回 0。
func readCPUUsage() float64 {
	stat1, err := readProcStatCPU()
	if err != nil {
		return 0
	}
	time.Sleep(200 * time.Millisecond)
	stat2, err := readProcStatCPU()
	if err != nil {
		return 0
	}

	// CPU 时间字段：user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice
	// 总时间 = 所有字段之和；空闲时间 = idle + iowait
	total1 := stat1.total
	idle1 := stat1.idle
	total2 := stat2.total
	idle2 := stat2.idle

	totalDelta := total2 - total1
	idleDelta := idle2 - idle1
	if totalDelta <= 0 {
		return 0
	}
	usage := (1.0 - float64(idleDelta)/float64(totalDelta)) * 100
	if usage < 0 {
		usage = 0
	}
	if usage > 100 {
		usage = 100
	}
	return usage
}

// procStatSummary 是 /proc/stat 第一行解析后的 CPU 时间摘要。
type procStatSummary struct {
	total uint64
	idle  uint64
}

// readProcStatCPU 读取 /proc/stat 第一行（聚合所有 CPU 核心）。
func readProcStatCPU() (procStatSummary, error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return procStatSummary{}, err
	}
	// 第一行格式：cpu  user nice system idle iowait irq softirq steal guest guest_nice
	line := strings.SplitN(string(data), "\n", 2)[0]
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return procStatSummary{}, nil
	}
	var total, idle uint64
	for i, f := range fields[1:] {
		val, err := strconv.ParseUint(f, 10, 64)
		if err != nil {
			continue
		}
		total += val
		// idle 是第 4 个数值字段（索引 3），iowait 是第 5 个（索引 4）
		if i == 3 || i == 4 {
			idle += val
		}
	}
	return procStatSummary{total: total, idle: idle}, nil
}

// readMemUsage 读取 /proc/meminfo 计算内存使用率（0-100）。
// 使用率 = (MemTotal - MemAvailable) / MemTotal * 100。
func readMemUsage() float64 {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	var memTotal, memAvailable uint64
	for _, line := range strings.Split(string(data), "\n") {
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}
		val, err := strconv.ParseUint(parts[1], 10, 64)
		if err != nil {
			continue
		}
		switch parts[0] {
		case "MemTotal:":
			memTotal = val
		case "MemAvailable:":
			memAvailable = val
		}
	}
	if memTotal == 0 {
		return 0
	}
	usage := float64(memTotal-memAvailable) / float64(memTotal) * 100
	if usage < 0 {
		usage = 0
	}
	if usage > 100 {
		usage = 100
	}
	return usage
}

// GetOutboundIP 返回主网卡的非回环 IPv4 地址。
// 找不到时返回空字符串。
func GetOutboundIP() string {
	// 通过拨号 UDP 获取本机出口 IP（不需要真正发送数据包）。
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return getInterfaceIP()
	}
	defer conn.Close()
	addr, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok || addr.IP == nil {
		return ""
	}
	ip := addr.IP.String()
	// 过滤回环地址
	if ip == "127.0.0.1" || ip == "::1" {
		return ""
	}
	return ip
}

// getInterfaceIP 遍历网卡接口查找非回环 IPv4 地址。
// 作为 GetOutboundIP 的兜底方案。
func getInterfaceIP() string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ""
	}
	for _, addr := range addrs {
		if ipNet, ok := addr.(*net.IPNet); ok && !ipNet.IP.IsLoopback() {
			if ipNet.IP.To4() != nil {
				return ipNet.IP.String()
			}
		}
	}
	return ""
}
