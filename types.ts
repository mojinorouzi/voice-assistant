
export enum AppStatus {
  IDLE = 'idle',
  LISTENING = 'listening',
  PROCESSING = 'processing',
  SPEAKING = 'speaking',
  ERROR = 'error',
}

export interface SseDataChunk {
  answer?: string;
  isComplete?: boolean;
  hasAnswer?: boolean;
  answerId?: string;
  rewrittenQuestion?: string;
  llmId?: number;
  fst?: number;
  lst?: number;
}
