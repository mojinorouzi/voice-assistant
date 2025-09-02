import React, { useState, useCallback, useRef, useEffect } from 'react';
import { AppStatus, SseDataChunk } from './types';
import { useSpeechRecognition } from './hooks/useSpeechRecognition';
import { useTextToSpeech } from './hooks/useTextToSpeech';
import { fetchAnswerStream } from './services/apiService';
import { MicrophoneIcon, StopCircleIcon, ArrowPathIcon, SpeakerWaveIcon } from './icons';


const DebugMonitor: React.FC<{ status: AppStatus; actionLog: string[]; apiLog: string[] }> = ({ status, actionLog, apiLog }) => (
    <div className="absolute top-4 left-4 bg-gray-900 bg-opacity-80 p-4 rounded-lg shadow-lg text-white font-mono text-xs w-full max-w-sm max-h-96 flex flex-col z-50">
        <div className="flex-shrink-0">
            <h2 className="text-lg font-bold mb-2 border-b border-gray-600 pb-1">Debug Monitor</h2>
            <p className="mb-2"><strong>Status:</strong> <span className="font-bold text-yellow-400">{status.toUpperCase()}</span></p>
        </div>
        <div className="flex-grow overflow-y-auto space-y-4 pr-2">
            <div>
                <h3 className="font-bold text-sm sticky top-0 bg-gray-900 bg-opacity-80 py-1">Workflow Log</h3>
                <div className="mt-1 space-y-1">
                    {actionLog.length === 0 ? <p className="text-gray-500">No actions yet.</p> : actionLog.map((log, i) => <p key={i} className="whitespace-pre-wrap break-all">{log}</p>)}
                </div>
            </div>
             <div>
                <h3 className="font-bold text-sm sticky top-0 bg-gray-900 bg-opacity-80 py-1">API Monitor</h3>
                <div className="mt-1 space-y-1">
                    {apiLog.length === 0 ? <p className="text-gray-500">No API activity yet.</p> : apiLog.map((log, i) => <p key={i} className="whitespace-pre-wrap break-all">{log}</p>)}
                </div>
            </div>
        </div>
    </div>
);


const App: React.FC = () => {
  const [status, rawSetStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [userQuestion, setUserQuestion] = useState<string>('');
  const [aiResponse, setAiResponse] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [apiLogs, setApiLogs] = useState<string[]>([]);
  
  const [isApiStreamFinished, setIsApiStreamFinished] = useState<boolean>(true);
  const [isTtsPlaybackComplete, setIsTtsPlaybackComplete] = useState<boolean>(true);

  const aiResponseBuffer = useRef<string>('');
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const wasAnythingSentToTtsRef = useRef<boolean>(false);

  const logAction = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setActionLog(prev => [...prev, `[${timestamp}] ${message}`]);
  }, []);

  const logApiEvent = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setApiLogs(prev => [...prev, `[${timestamp}] ${message}`]);
  }, []);

  const setStatus = useCallback((newStatus: AppStatus) => {
    logAction(`Status change: ${status} -> ${newStatus}`);
    rawSetStatus(newStatus);
  }, [logAction, status]);

  const handleError = useCallback((err: unknown, isFatal: boolean = true) => {
    let message = 'An unexpected error occurred. Please try again.';

    if (typeof err === 'string') {
        if (err.includes('Speech recognition is not supported')) {
            message = "Sorry, your browser doesn't support voice commands.";
        } else if (err.includes('Text-to-speech not supported')) {
            message = "Text-to-speech is not available. Answers will be text-only.";
        } else if (err.includes('not-allowed')) {
            message = 'Microphone access is needed. Please allow it in your browser settings.';
        } else if (err.includes('network')) {
            message = 'A network error occurred during speech recognition. Please check your connection.';
        } else {
            message = err; 
        }
    } else if (err instanceof Error) {
        if (err.message.includes('Failed to fetch')) {
            message = 'Could not connect to the server. Please check your internet connection.';
        } else if (err.message.startsWith('API error: 4')) {
            message = 'There was a problem with the request. Please try rephrasing.';
        } else if (err.message.startsWith('API error: 5')) {
            message = 'The server is having trouble right now. Please try again in a moment.';
        } else {
            message = 'An unknown error occurred while getting the response.';
        }
    }
    
    logAction(`Error handled: ${message}`);
    setErrorMessage(message);
    if (isFatal) {
        setStatus(AppStatus.ERROR);
    }
  }, [logAction, setStatus]);

  const handleSpeechEnd = useCallback(() => {
    rawSetStatus(currentStatus => {
        if (currentStatus === AppStatus.LISTENING) {
            logAction('Speech recognition ended without a result. Returning to idle.');
            return AppStatus.IDLE;
        }
        return currentStatus;
    });
  }, [logAction]);
  
  const handlePlaybackEnd = useCallback(() => {
    logAction('TTS playback has fully completed.');
    setIsTtsPlaybackComplete(true);
  }, [logAction]);

  const speechRecognition = useSpeechRecognition(
    useCallback((transcript: string) => handleSpeechResultRef.current(transcript), []), 
    handleSpeechEnd
  );

  const { speak, cancel, isSupported: isTtsSupported } = useTextToSpeech(handlePlaybackEnd);

  const handleSpeechResultRef = useRef<(transcript: string) => void>(() => {});

  const handleSpeechResult = useCallback(async (transcript: string) => {
    logAction(`Speech recognized: "${transcript}"`);
    if (!transcript.trim()) {
      logAction('Transcript is empty, returning to IDLE.');
      setStatus(AppStatus.IDLE);
      return;
    }
    
    setActionLog(prev => [`[${new Date().toLocaleTimeString()}] New Conversation Started`]);
    setApiLogs([]);
    setIsApiStreamFinished(false);
    setIsTtsPlaybackComplete(false);
    wasAnythingSentToTtsRef.current = false;

    setStatus(AppStatus.PROCESSING);
    setUserQuestion(transcript);
    setAiResponse('');
    aiResponseBuffer.current = '';
    abortControllerRef.current = new AbortController();

    fetchAnswerStream(
      transcript,
      (data: SseDataChunk) => {
        if (data.isComplete) {
          logAction('Final API chunk received and ignored.');
          return;
        }

        if (data.answer) {
          setAiResponse(prev => prev + (data.answer || ''));

          if (isTtsSupported) {
            aiResponseBuffer.current += (data.answer || '');
            const buffer = aiResponseBuffer.current;
            
            let lastCutoff = -1;
            const sentenceEnders = '.?!؟';
            for (let i = buffer.length - 1; i >= 0; i--) {
                if (sentenceEnders.includes(buffer[i])) {
                    lastCutoff = i + 1;
                    break;
                }
            }

            if (lastCutoff !== -1) {
                const textToProcess = buffer.substring(0, lastCutoff);
                aiResponseBuffer.current = buffer.substring(lastCutoff);
                
                const sentenceBoundarySplitRegex = /(?<=[.?!؟])\s*/g;
                const sentences = textToProcess.split(sentenceBoundarySplitRegex).filter(s => s.trim());

                for (const sentence of sentences) {
                    if (sentence) {
                        wasAnythingSentToTtsRef.current = true;
                        logAction(`Speaking sentence: "${sentence.trim()}"`);
                        speak(sentence.trim());
                    }
                }
            }
          }
        }
      },
      (error: Error) => {
        handleError(error);
      },
      () => { // onComplete
        logAction('API stream completed.');
        if (isTtsSupported) {
          if (aiResponseBuffer.current.trim()) {
            wasAnythingSentToTtsRef.current = true;
            logAction(`Speaking final part: "${aiResponseBuffer.current.trim()}"`);
            speak(aiResponseBuffer.current.trim());
            aiResponseBuffer.current = '';
          }
        }
        setIsApiStreamFinished(true);

        if (!wasAnythingSentToTtsRef.current) {
          logAction('API stream finished with no audible response. Finalizing.');
          setIsTtsPlaybackComplete(true);
        }
      },
      abortControllerRef.current.signal,
      logApiEvent
    );
  }, [isTtsSupported, speak, logAction, logApiEvent, setStatus, handleError]);

  useEffect(() => {
    handleSpeechResultRef.current = handleSpeechResult;
  }, [handleSpeechResult]);

  useEffect(() => {
    if (isApiStreamFinished && isTtsPlaybackComplete) {
      if (status === AppStatus.PROCESSING) {
        logAction('API stream and TTS playback complete. Activating listener.');
        if (speechRecognition.isSupported) {
          speechRecognition.startListening();
          setStatus(AppStatus.LISTENING);
        } else {
          setStatus(AppStatus.IDLE);
        }
      }
    }
  }, [isApiStreamFinished, isTtsPlaybackComplete, status, logAction, setStatus, speechRecognition]);

  useEffect(() => {
    if (!speechRecognition.isSupported) {
        handleError('Speech recognition is not supported in this browser.', true);
    } else if (speechRecognition.error) {
        handleError(speechRecognition.error, true);
    } else if (!isTtsSupported) {
        handleError('Text-to-speech not supported. Responses will be text-only.', false);
    }
  }, [speechRecognition.isSupported, speechRecognition.error, isTtsSupported, handleError]);

  useEffect(() => {
    if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [userQuestion, aiResponse, status]);

  const handlePrimaryButtonClick = () => {
    logAction(`Primary button clicked in state: ${status}`);
    setErrorMessage('');
    switch (status) {
      case AppStatus.IDLE:
        setUserQuestion('');
        setAiResponse('');
        speechRecognition.startListening();
        setStatus(AppStatus.LISTENING);
        break;
      case AppStatus.LISTENING:
        speechRecognition.stopListening();
        setStatus(AppStatus.IDLE);
        break;
      case AppStatus.ERROR:
        setUserQuestion('');
        setAiResponse('');
        setStatus(AppStatus.IDLE);
        break;
      case AppStatus.PROCESSING:
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        cancel();
        setStatus(AppStatus.IDLE);
        break;
      case AppStatus.SPEAKING: // This case is now effectively handled by PROCESSING
         break;
    }
  };

  const getButtonState = () => {
    switch (status) {
      case AppStatus.IDLE:
        return { icon: <MicrophoneIcon />, text: 'Tap to Speak', color: 'bg-blue-600 hover:bg-blue-700', animation: '' };
      case AppStatus.LISTENING:
        return { icon: <div className="w-8 h-8 bg-red-500 rounded-md"></div>, text: 'Listening...', color: 'bg-red-600', animation: 'animate-pulse' };
      case AppStatus.PROCESSING:
        return { icon: <ArrowPathIcon className="animate-spin" />, text: 'Stop', color: 'bg-green-600 hover:bg-green-700', animation: '' };
      case AppStatus.ERROR:
        return { icon: <ArrowPathIcon />, text: 'Retry', color: 'bg-yellow-600 hover:bg-yellow-700', animation: '' };
      default: // Includes SPEAKING
        return { icon: <MicrophoneIcon />, text: 'Start', color: 'bg-blue-600 hover:bg-blue-700', animation: '' };
    }
  };
  
  const { icon, text, color, animation } = getButtonState();

  return (
    <div className="bg-gray-900 text-white h-screen w-screen flex flex-col items-center justify-end p-4 font-sans relative">
        <DebugMonitor status={status} actionLog={actionLog} apiLog={apiLogs} />

        <div ref={chatContainerRef} className="w-full max-w-2xl flex-grow overflow-y-auto mb-4 flex flex-col space-y-4 pr-2">
            {userQuestion && (
                <div className="flex justify-end">
                    <div className="bg-blue-600 rounded-xl rounded-br-none p-3 max-w-xs sm:max-w-md">
                        <p>{userQuestion}</p>
                    </div>
                </div>
            )}
            {(status === AppStatus.PROCESSING || aiResponse) && (
                <div className="flex justify-start">
                    <div className="bg-gray-700 rounded-xl rounded-bl-none p-3 max-w-xs sm:max-w-md">
                        <p>
                            {aiResponse}
                            {status === AppStatus.PROCESSING && (
                                <span className="inline-block align-bottom w-0.5 h-5 bg-white animate-blink ml-1" aria-hidden="true"></span>
                            )}
                        </p>
                    </div>
                </div>
            )}
             {status === AppStatus.IDLE && !userQuestion && (
                <div className="flex-grow flex items-center justify-center">
                    <div className="text-center text-gray-500">
                        <h1 className="text-3xl font-bold mb-2">AI Voice Assistant</h1>
                        <p>Tap the microphone to start a conversation.</p>
                    </div>
                </div>
             )}
        </div>
        
        <div className="flex flex-col items-center space-y-3 w-full max-w-2xl">
            <button
                onClick={handlePrimaryButtonClick}
                className={`w-20 h-20 rounded-full flex items-center justify-center text-white transition-all duration-300 ease-in-out shadow-lg focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-white ${color} ${animation}`}
                aria-label={text}
            >
                {icon}
            </button>
            <p className="text-gray-400 h-5">{errorMessage || text}</p>
        </div>
    </div>
  );
};

export default App;
