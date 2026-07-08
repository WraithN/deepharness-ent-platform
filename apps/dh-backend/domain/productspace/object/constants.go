// Package object defines domain types and constants for the product-space module.
package object

const (
	ProductSpaceRoot          = "products"
	ProductSpaceDocsDir       = "docs"
	ProductSpacePrototypesDir = "prototypes"

	ItemTypeDoc       = "doc"
	ItemTypePrototype = "prototype"

	NodeTypeFolder = "folder"

	DocExtMarkdown = "md"
	DocExtText     = "txt"

	MaxPrototypeSizeBytes = 50 * 1024 * 1024 // 50MB
	MaxDocSizeBytes       = 10 * 1024 * 1024 // 10MB
)

var AllowedDocExts = map[string]bool{"md": true, "txt": true}
var AllowedPrototypeExts = map[string]bool{"png": true, "jpg": true, "jpeg": true, "pdf": true}
