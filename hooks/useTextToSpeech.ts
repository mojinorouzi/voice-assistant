import { useState, useRef, useCallback, useEffect } from 'react';

const API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4NzUwMjhjNTBlZGYzZTdlZDQ5YzcyNiIsInRpZCI6InZvaWNlIiwic2FsdCI6ImpVa3o4VXRtaDAiLCJpYXQiOjE3NTI0OTQ0MDAsIm5iZiI6MTc1MjQ5NDQwMCwiZXhwIjoxNzg0MDU0Mzk5fQ.UHVlFfzQbNO3isdl17HxPL46e4YnCv6WSAl-31UHn-8';
const REQUEST_URL = 'https://cerebro.isahab.ir/service/avasho/request';
const DOWNLOAD_URL_BASE = 'https://cerebro.isahab.ir/service/avasho/download/';

export const useTextToSpeech = (onPlaybackEnd: () => void) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioQueue = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isProcessingQueue = useRef(false);
  const currentAudioUrl = useRef<string | null>(null);

  const onPlaybackEndRef = useRef(onPlaybackEnd);
  useEffect(() => {
    onPlaybackEndRef.current = onPlaybackEnd;
  });

  const processQueue = useCallback(async () => {
    if (audioQueue.current.length === 0) {
      isProcessingQueue.current = false;
      setIsSpeaking(false);
      onPlaybackEndRef.current();
      return;
    }

    if (isProcessingQueue.current) {
      return;
    }

    isProcessingQueue.current = true;
    setIsSpeaking(true);

    const text = audioQueue.current.shift();
    if (!text) {
      isProcessingQueue.current = false;
      setIsSpeaking(false);
      return;
    }

    try {
      const requestResponse = await fetch(REQUEST_URL, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'x-api-key': API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          speaker: "shahrzad",
          speed: 1.2,
          timestamp: true
        })
      });

      if (!requestResponse.ok) {
        throw new Error(`TTS request API failed: ${requestResponse.statusText}`);
      }
      
      const responseData = await requestResponse.json();
      const audioId = responseData?.data?.id;

      if (!audioId) {
        throw new Error('TTS request did not return a valid ID.');
      }

      const downloadResponse = await fetch(`${DOWNLOAD_URL_BASE}${audioId}`, {
        headers: {
            'accept': 'application/octet-stream',
            'x-api-key': API_KEY,
        }
      });
      
      if (!downloadResponse.ok) {
          throw new Error(`TTS download API failed: ${downloadResponse.statusText}`);
      }
      
      const audioBlob = await downloadResponse.blob();
      
      if (currentAudioUrl.current) {
        URL.revokeObjectURL(currentAudioUrl.current);
      }
      
      const audioUrl = URL.createObjectURL(audioBlob);
      currentAudioUrl.current = audioUrl;

      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      
      audioRef.current.src = audioUrl;
      audioRef.current.play().catch(e => {
          console.error("Audio playback failed:", e);
          isProcessingQueue.current = false;
          processQueue();
      });
      
      audioRef.current.onended = () => {
        isProcessingQueue.current = false;
        processQueue();
      };
      
    } catch (error) {
      console.error('Error in text-to-speech process:', error);
      isProcessingQueue.current = false;
      setIsSpeaking(false); 
      audioQueue.current = [];
      onPlaybackEndRef.current();
    }
  }, []);

  const speak = useCallback((text: string) => {
    if (!text.trim()) {
      return;
    }
    audioQueue.current.push(text);
    if (!isProcessingQueue.current) {
      processQueue();
    }
  }, [processQueue]);

  const cancel = useCallback(() => {
    audioQueue.current = [];
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    if (currentAudioUrl.current) {
        URL.revokeObjectURL(currentAudioUrl.current);
        currentAudioUrl.current = null;
    }
    isProcessingQueue.current = false;
    setIsSpeaking(false);
  }, []);
  
  useEffect(() => {
    return () => {
        cancel();
    }
  }, [cancel]);

  // The hook now returns isSupported as true, because it uses an API
  // and does not depend on a specific browser feature.
  // The warmUp function is removed as it is no longer needed.
  return { speak, cancel, isSpeaking, isSupported: true };
};
