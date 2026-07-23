/* ==========================================================================
   dh-base.js - DeepHarness 原型脚手架 JavaScript 工具库
   提供 mock 数据存储、格式化、Toast 通知等通用函数。
   agent 在页面 <script> 中直接调用，无需重复实现。
   加载顺序：本文件 -> Alpine.js (defer)
   ========================================================================== */

/* ── Mock 数据存储（基于 localStorage，刷新不丢失） ── */
const dhStore = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },
  set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  },
  remove(key) {
    localStorage.removeItem(key);
  },
};

/* ── 格式化工具 ── */
function formatMoney(n) {
  if (n == null || isNaN(n)) return '0';
  return Number(n).toLocaleString('zh-CN');
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return dt.getFullYear() + '-' + m + '-' + day;
}

function formatDateTime(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt)) return String(d);
  return formatDate(d) + ' ' + String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
}

/* ── Toast 通知 ── */
function showToast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  var el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(function() {
    el.style.opacity = '0';
    el.style.transition = 'opacity .3s';
    setTimeout(function() { el.remove(); }, 300);
  }, 3000);
}

/* ── URL 参数读取（用于 edit.html?id=xxx 等） ── */
function getUrlParam(name) {
  var params = new URLSearchParams(window.location.search);
  return params.get(name) || '';
}

/* ── 状态标签辅助函数（可在页面 <script> 中覆盖） ── */
function getStatusLabel(status) {
  var labels = { active: '进行中', draft: '草稿', ended: '已结束', pending: '待审核', approved: '已审批', rejected: '已驳回' };
  return labels[status] || status;
}

function getStatusTagClass(status) {
  var classes = { active: 'tag-green', draft: 'tag-gray', ended: 'tag-red', pending: 'tag-yellow', approved: 'tag-blue', rejected: 'tag-red' };
  return classes[status] || 'tag-gray';
}

/* ── 防抖工具 ── */
function debounce(fn, delay) {
  var timer;
  return function() {
    var ctx = this, args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function() { fn.apply(ctx, args); }, delay || 300);
  };
}
