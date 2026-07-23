/** 全局常量定义。 */

/** localStorage key：做原型跨标签页通信。 */
export const PROTO_MAKE_PENDING_KEY = 'dh-proto-make-pending';

/** localStorage key：存储当前用户 token（开发期为用户 ID），用于 API 鉴权。 */
export const AUTH_TOKEN_KEY = 'token';

/** 鉴权 cookie 名称：供 iframe / <img> 等无法设置 Authorization 头的浏览器原生请求自动携带。 */
export const AUTH_COOKIE_NAME = 'dh_auth';

/** 鉴权 cookie 有效期（秒）：7 天。 */
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
