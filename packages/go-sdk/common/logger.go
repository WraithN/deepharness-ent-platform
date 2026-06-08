package common

import "log"

// Logger 简单日志封装
func Logger(name string) *log.Logger {
	return log.New(log.Writer(), "["+name+"] ", log.LstdFlags|log.Lshortfile)
}
