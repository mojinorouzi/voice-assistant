// FIX: Add type definitions for Web Speech API and rename SpeechRecognition constant to resolve TypeScript errors.
// Type definitions for the Web Speech API. These are not included in standard
// DOM typings as the API is experimental.
interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
  readonly resultIndex: number;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechRecognitionStatic {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionStatic;
    webkitSpeechRecognition?: SpeechRecognitionStatic;
  }
}

import { useState, useEffect, useRef, useCallback } from 'react';

// Polyfill for browsers that might not have it on `window`
const SpeechRecognitionImpl =
  window.SpeechRecognition || window.webkitSpeechRecognition;

export const useSpeechRecognition = (
  onResult: (transcript: string) => void,
  onEnd?: () => void
) => {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const manualStopRef = useRef(false);
  const fatalErrorRef = useRef<string | null>(null); // To track fatal errors synchronously

  const onResultRef = useRef(onResult);
  const onEndRef = useRef(onEnd);

  useEffect(() => {
    onResultRef.current = onResult;
    onEndRef.current = onEnd;
  });

  useEffect(() => {
    if (!SpeechRecognitionImpl) {
      setError('Speech recognition is not supported in this browser.');
      return;
    }

    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = false; // Stop after the first final result
    recognition.lang = 'fa-IR'; // Set to Persian as per API example
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onend = () => {
      setIsListening(false);
      // Recognition has ended (either by result, timeout, or manual stop).
      // The component's logic will handle the state transition.
      if (onEndRef.current) {
        onEndRef.current();
      }
    };

    recognition.onerror = (event) => {
      // 'no-speech' is common and should not be treated as a fatal error.
      // 'aborted' is from a manual stop, which is handled by manualStopRef.
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
          fatalErrorRef.current = event.error;
          setError(`Speech recognition error: ${event.error}`);
      }
      setIsListening(false);
    };

    recognition.onresult = (event) => {
      // With continuous mode off, we expect only one final result.
      const transcript = event.results[event.results.length - 1][0].transcript;
      onResultRef.current(transcript);
    };

    recognitionRef.current = recognition;

    // Cleanup function
    return () => {
      if (recognitionRef.current) {
        manualStopRef.current = true; // Ensure it doesn't restart on unmount
        recognitionRef.current.onstart = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.stop();
      }
    };
  }, []); // Empty dependency array ensures this runs only once.

  const startListening = useCallback(() => {
    if (recognitionRef.current && !isListening) {
      manualStopRef.current = false; // Reset the flag
      fatalErrorRef.current = null;  // Reset the fatal error flag
      setError(null);
      try {
        recognitionRef.current.start();
      } catch (e) {
        // This can happen if start() is called too soon after stop()
        console.error("Could not start recognition:", e);
        setError("Could not start listening. Please try again.");
      }
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current && isListening) {
      manualStopRef.current = true; // Set the flag to prevent any potential restarts
      recognitionRef.current.stop();
    }
  }, [isListening]);

  return { isListening, error, startListening, stopListening, isSupported: !!SpeechRecognitionImpl };
};