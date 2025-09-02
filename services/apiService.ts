import { SseDataChunk } from '../types';

const API_URL = 'https://api.danabot.ir/api/core/v4/faq/15e64770-0ff1-4ebc-9921-bb68d0d1a458/f78f2762-0cfe-4a5a-b76e-ba77f3424951';

export const fetchAnswerStream = async (
  question: string,
  onData: (data: SseDataChunk) => void,
  onError: (error: Error) => void,
  onComplete: () => void,
  signal: AbortSignal,
  onLog: (message: string) => void
) => {
  const requestBody = {
    type: 'TEXT',
    question: question,
  };

  onLog(`[REQUEST] POST ${API_URL}`);
  onLog(`Payload: ${JSON.stringify(requestBody, null, 2)}`);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'accept': '*/*',
      },
      body: JSON.stringify(requestBody),
      signal,
    });
    
    onLog(`[RESPONSE] Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const apiError = new Error(`API error: ${response.status} ${response.statusText}`);
      onError(apiError);
      return; 
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Could not get response reader');
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const processStream = async () => {
      while (true) {
        const { done, value } = await reader.read();
        
        if (value) {
            buffer += decoder.decode(value, { stream: true });
        }
        
        const lines = buffer.split('\n');
        buffer = done ? '' : (lines.pop() || '');

        for (const line of lines) {
          if (line.startsWith('data:')) {
            const jsonString = line.substring(5).trim();
            if (jsonString) {
                onLog(`[STREAM DATA] ${jsonString.substring(0, 200)}${jsonString.length > 200 ? '...' : ''}`);
                try {
                    const parsedData: SseDataChunk = JSON.parse(jsonString);
                    onData(parsedData);
                } catch (e) {
                    console.error('Failed to parse SSE data chunk:', jsonString, e);
                    onLog(`[STREAM PARSE ERROR] ${e instanceof Error ? e.message : String(e)}`);
                }
            }
          }
        }
        
        if (done) {
          break;
        }
      }

      onComplete();
    };

    await processStream();

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log('Fetch aborted by user.');
      onLog('[REQUEST ABORTED]');
      return;
    }
    
    console.error('Error fetching answer stream:', error);
    onLog(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
    onError(error as Error);
  }
};
