import type { PrototypeComment } from '@/lib/productspace-api';
import type { ShareComment } from '@/lib/productdoc-api';

/**
 * 批注在 UI 层的统一展示类型。
 * 将原型批注（PrototypeComment）与文档批注（ShareComment）映射为同一结构，
 * 便于在评论列表、Sheet、详情弹窗中复用渲染逻辑。
 */
export interface DisplayComment {
  id: string;
  /** 序号：按时间正序分配，最早为 1，与列表顺序一致 */
  seq: number;
  /** 评论人名称 */
  author: string;
  /** 评论内容 */
  content: string;
  /** 锚点文本：原型为 targetText，文档为 quoteText */
  targetText?: string;
  /** 创建时间（ISO 字符串） */
  createdAt: string;
  /** 原始数据 */
  raw: PrototypeComment | ShareComment;
}

/**
 * 当前激活的批注类型，用于跨标签页统一导航。
 */
export type ActiveComment =
  | { type: 'prototype'; comment: PrototypeComment }
  | { type: 'doc'; comment: ShareComment };
