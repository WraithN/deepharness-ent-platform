# 团队技能 / 提示词中文乱码

## 现象

在「智能会话」输入框的技能、提示词下拉菜单中，中文内容显示为乱码，例如：

- `代码补全专家` 显示为 `Ã¤Â»Â£Ã§Â ÂÃ¨Â¡Â¥Ã¥â¦Â¨Ã¤Â¸âÃ¥Â®Â¶`
- 提示词标题与内容也出现类似的 `Ã¥...` 形式乱码

浏览器开发者工具中，后端返回的 JSON 字节为双重编码后的 UTF-8：`C3A4C2BBC2A3...`。

## 根因

1. `team_skills` / `team_prompts` 表的种子数据通过 `docker exec -i ... mysql ... < schema.sql` 手动导入。
2. 执行时未指定 `--default-character-set=utf8mb4`，MySQL 客户端默认使用 `latin1` 读取 SQL 文件。
3. SQL 文件本身为 UTF-8 编码，中文字符（如 `E4BBA3`）被客户端当作 `latin1` 解释成 `ä»£`，随后以 `utf8mb4` 写入表，形成双重编码（`C3A4C2BB...`）。
4. Go 后端使用 `charset=utf8mb4` 读取时，得到的是已经双重编码的字节，直接序列化到 JSON 即表现为乱码。

## 解决方案

1. 删除已损坏的 `team_skills` / `team_prompts` 表。
2. 使用 `--default-character-set=utf8mb4` 重新导入 `infra/database/team/schema.sql`：

   ```bash
   docker exec -i deepharness-mysql mysql -u root -pdeepharness_root deepharness --default-character-set=utf8mb4 < infra/database/team/schema.sql
   ```

3. 在 `infra/database/team/schema.sql` 文件头部增加 `SET NAMES utf8mb4; SET CHARACTER SET utf8mb4;`，确保无论是手动导入还是 Docker 初始化脚本执行，客户端连接字符集都为 `utf8mb4`。
4. 验证后端 API 返回的中文 HEX 为正常 UTF-8 编码（如 `代码补全专家` -> `E4BBA3E7A081E8A1A5E585A8E4B893E5AEB6`）。

## 验证结果

- `GET /api/v1/team/skills` 返回中文正常
- `GET /api/v1/team/prompts` 返回中文正常
- 前端技能/提示词下拉菜单不再出现乱码
