# SSH 私钥明文存储于数据库 `repositories.ssh_key` 列

## 现象

SSH 私钥以明文存入数据库 `repositories.ssh_key` 列，存在安全风险。
虽然 API 响应已通过 `sanitizeRepo` 过滤 SSHKey 字段（`domain/repository/handler.go:24`），
但数据库中的明文私钥一旦遭遇数据库泄露（SQL 注入、备份泄露、内部人员访问等），
攻击者即可直接获取用户私钥，进而访问其关联的所有 Git 仓库。

## 根因

`DBRepositoryService.Create` / `Update` 方法在创建/更新仓库时，
直接将 `resolveSSHKey` 返回的明文 SSH 私钥写入 `repositories.ssh_key` 列：

```go
// db_service.go (修复前)
sshKey, _ := s.resolveSSHKey(userID)
r.SSHKey = sshKey
// 直接将明文 sshKey 存入 DB
_, err = s.db.Exec(`INSERT INTO repositories (..., ssh_key, ...) VALUES (..., $7, ...)`, ..., sshKey, ...)
```

`List` / `Get` 方法读取时也不做解密，直接返回明文。

问题链路：
1. 用户在个人设置中配置 SSH 私钥（存入 `user_profiles.ssh_key`）
2. 创建仓库时 `dbSSHKeyResolver` 从 `user_profiles` 读取明文私钥
3. 明文私钥直接 INSERT 到 `repositories.ssh_key` 列
4. 数据库中持久保存明文私钥，存在泄露风险

## 解决方案

### 1. 新增加密工具包 `pkg/crypto/crypto.go`

使用 AES-256-GCM 对称加密，关键设计：
- 加密后的密文以 `"enc:"` 前缀标识，便于区分加密数据与历史明文数据
- key 为空时，`Encrypt` 返回原文、`Decrypt` 也返回原文（开发环境兼容）
- 每次加密生成随机 nonce，nonce 拼接在密文前部
- `Decrypt` 遇到无 `"enc:"` 前缀的数据时返回原文（兼容历史明文数据）
- 提供 `ParseKey` 函数将 hex 编码的字符串解析为 32 字节 AES-256 密钥

### 2. config 添加加密密钥配置

- `config/config.go`：`Config` struct 新增 `SSHKeyEncryptionKey` 字段
- `yamlConfig` 新增 `Security.SSHKeyEncryptionKey`（yaml tag: `ssh_key_encryption_key`）
- 环境变量 `SSH_KEY_ENCRYPTION_KEY` 覆盖 yaml 配置
- `config.yaml` 新增 `security` 配置段及生成方法说明

### 3. repository service 加密/解密

- `DBRepositoryService` struct 新增 `encryptionKey []byte` 字段
- `NewDBRepositoryService` 构造函数新增 `encryptionKey` 参数
- `Create`：加密 SSH key 后存入 DB
- `Update`：加密 SSH key 后存入 DB
- `Get`：从 DB 读取后解密 SSH key
- `List`：从 DB 读取后解密每个仓库的 SSH key
- 新增 `decryptSSHKey` 辅助方法（解密失败时返回空字符串并记录日志）

### 4. server.go 传入密钥

- `initRepositoryService` 调用 `crypto.ParseKey` 解析 hex 密钥
- 解析失败时 `log.Fatalf`（配置错误，不应继续启动）
- 将解析后的 `[]byte` 密钥传入 `NewDBRepositoryService`

### 涉及文件

- `apps/dh-backend/pkg/crypto/crypto.go`：新增加密工具包（Encrypt / Decrypt / ParseKey）
- `apps/dh-backend/config/config.go`：新增 `SSHKeyEncryptionKey` 配置字段、yaml 映射、环境变量覆盖
- `apps/dh-backend/config.yaml`：新增 `security` 配置段
- `apps/dh-backend/domain/repository/service/db_service.go`：struct 新增字段、构造函数参数、Create/Update 加密、Get/List 解密
- `apps/dh-backend/gateway/server/server.go`：解析密钥并传入构造函数

### 兼容性

- **历史明文数据**：`Decrypt` 检测到无 `"enc:"` 前缀时返回原文，不会破坏已有数据
- **开发环境**：key 为空时 `Encrypt` 返回原文、`Decrypt` 返回原文，无需配置即可正常使用
- **API 响应**：`sanitizeRepo` 仍过滤 SSHKey 字段，API 行为不变

### 验证

- `go build ./...`：编译通过，0 errors
- `go vet ./...`：0 warnings
- 配置 key 后，新创建的仓库 `ssh_key` 列存储 `enc:...` 格式密文
- 未配置 key 时（开发环境），`ssh_key` 列存储明文，功能不受影响
- 历史明文数据可通过 Get/List 正常读取（Decrypt 兼容无前缀数据）
