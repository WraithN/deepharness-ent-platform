export interface ChatPart {
  id: string;
  type: string;
  content: string;
  artifact?: any;
  metadata?: any;
}

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  parts: ChatPart[];
  messageID?: string;
  quotedCard?: { type: 'req' | 'defect' | 'case'; id: string; title: string; reporter: string };
  selectedRepos?: { id: string; name: string }[];
}
