// Package object 定义 crawler 模块的领域类型。
package object

// Cookie 是浏览器 cookie 的简化表示，与 Playwright 格式兼容。
type Cookie struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Domain   string `json:"domain,omitempty"`
	Path     string `json:"path,omitempty"`
	Expires  int64  `json:"expires,omitempty"`
	HttpOnly bool   `json:"httpOnly,omitempty"`
	Secure   bool   `json:"secure,omitempty"`
	SameSite string `json:"sameSite,omitempty"`
}

// SaveCookiesRequest 保存某个域名的 cookie 列表。
type SaveCookiesRequest struct {
	Domain  string   `json:"domain"`
	Cookies []Cookie `json:"cookies"`
}
