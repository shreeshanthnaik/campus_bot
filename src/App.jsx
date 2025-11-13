import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAnalytics } from "firebase/analytics";
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { Bot, Cpu, Send, Mic, X, Loader2, Settings, Brain, Volume2, CalendarDays, Clock } from 'lucide-react'; 

// --- Import the JSON file directly ---
import locationData from './campus_data.json';

// --- CONFIGURATION ---
// We now safely read your keys from the .env file
const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY; 

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// 3. This is a unique name for your app's data in Firestore
const appId = "campus-bot-v1";
// --- GLOBAL FIREBASE INITIALIZATION ---
// ... (the rest of your App.jsx file remains the same)

// --- GLOBAL FIREBASE INITIALIZATION ---
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);

const DEFAULT_AI_CONFIG = {
    persona: "You are a friendly and helpful campus guide bot. Your job is to help students find locations on campus.",
    tone: "casual and helpful",
    maxLength: 100,
    selectedVoiceName: null, 
};

// --- Helper function to get today's date string ---
const getTodayDateString = () => new Date().toISOString().split('T')[0];

// --- Main App Component ---
export default function App() {
    // Firebase State
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    // App State
    const [aiConfig, setAiConfig] = useState(DEFAULT_AI_CONFIG);
    const [knowledgeBase, setKnowledgeBase] = useState([]);
    const [availableVoices, setAvailableVoices] = useState([]); 
    const [todayEvents, setTodayEvents] = useState([]); 

    // Chat State
    const [chatHistory, setChatHistory] = useState([]);
    const [userInput, setUserInput] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const chatHistoryRef = useRef(null);
    const recognitionRef = useRef(null);

    // Admin State
    const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
    const [feedback, setFeedback] = useState("");
    const [upgradeMessage, setUpgradeMessage] = useState("");
    const [isUpgrading, setIsUpgrading] = useState(false);
    
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [passwordInput, setPasswordInput] = useState("");
    const [passwordError, setPasswordError] = useState("");
    const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);

    // --- Event Management State ---
    const [newEventName, setNewEventName] = useState("");
    const [newEventVenue, setNewEventVenue] = useState("");
    const [newEventTime, setNewEventTime] = useState(""); 
    const [isEventUpdating, setIsEventUpdating] = useState(false);
    const [adminSelectedDate, setAdminSelectedDate] = useState(getTodayDateString());
    const [adminEventsList, setAdminEventsList] = useState([]);

    // --- Firebase Authentication ---
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                setUserId(user.uid);
                if (!isAuthReady) setIsAuthReady(true);
            } else {
                signInAnonymously(auth).catch(console.error);
            }
        });
        return () => unsubscribe();
    }, [isAuthReady]);

    // --- Firestore Listener for AI Config ("Bot DNA") ---
    const getAIConfigDocRef = useCallback((dbInstance, currentUserId) => {
        if (!dbInstance || !currentUserId) return null;
        return doc(dbInstance, 'campus_bot_dna', currentUserId);
    }, []);

    useEffect(() => {
        if (!isAuthReady || !userId) return;

        const configDocRef = getAIConfigDocRef(db, userId);
        if (!configDocRef) return;

        const unsubscribe = onSnapshot(configDocRef, (docSnap) => {
            if (docSnap.exists()) {
                setAiConfig({ ...DEFAULT_AI_CONFIG, ...docSnap.data() });
            } else {
                setAiConfig(DEFAULT_AI_CONFIG);
                setDoc(configDocRef, DEFAULT_AI_CONFIG).catch(console.error);
            }
        }, (error) => {
            console.error("Error listening to AI config:", error);
            addMessage({ sender: 'bot', text: "Error: Could not load bot DNA." });
        });

        return () => unsubscribe();
    }, [isAuthReady, userId, getAIConfigDocRef]);

    // --- Knowledge Base Loading ---
    useEffect(() => {
        try {
            setKnowledgeBase(locationData);
        } catch (error) {
            console.error('Failed to load campus_data.json from import:', error);
            addMessage({ sender: 'bot', text: "Error: Could not load campus location data." });
        }
    }, []);
    
    // --- Fetch *Today's* Events from Firestore (for the BOT) ---
    useEffect(() => {
        if (!isAuthReady) return; 
        const today = getTodayDateString();
        const eventDocRef = doc(db, 'campus_bot_events', today);
        const unsubscribe = onSnapshot(eventDocRef, (docSnap) => {
            if (docSnap.exists()) {
                setTodayEvents(docSnap.data().events || []);
                console.log("BOT: Today's events loaded:", docSnap.data().events);
            } else {
                console.log("BOT: No events scheduled for today.");
                setTodayEvents([]);
            }
        }, (error) => {
            console.error("BOT: Error fetching today's events:", error);
        });
        return () => unsubscribe(); 
    }, [isAuthReady]);

    // --- Fetch *Selected Date's* Events (for the ADMIN) ---
    useEffect(() => {
        if (!isAdminPanelOpen || !isAuthReady) return;
        const eventDocRef = doc(db, 'campus_bot_events', adminSelectedDate);
        const unsubscribe = onSnapshot(eventDocRef, (docSnap) => {
            if (docSnap.exists()) {
                setAdminEventsList(docSnap.data().events || []);
                console.log(`ADMIN: Events for ${adminSelectedDate} loaded.`);
            } else {
                setAdminEventsList([]);
                console.log(`ADMIN: No events found for ${adminSelectedDate}.`);
            }
        });
        return () => unsubscribe();
    }, [isAdminPanelOpen, isAuthReady, adminSelectedDate]);
    
    // --- Load Speech Synthesis Voices ---
    useEffect(() => {
        const populateVoiceList = () => {
            const voices = window.speechSynthesis.getVoices();
            if (voices.length > 0) {
                setAvailableVoices(voices.filter(voice => voice.lang.includes('en')));
            }
        };
        populateVoiceList();
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = populateVoiceList;
        }
    }, []);
    
    // --- Chat History Scrolling ---
    useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [chatHistory]);
    
    // --- Initial Greeting ---
    useEffect(() => {
        if(isAuthReady && knowledgeBase.length > 0 && chatHistory.length === 0) {
            setTimeout(() => {
                const greeting = "Hello! I am your campus assistant. Ask me where to find any location or what's happening today!";
                addMessage({ sender: 'bot', text: greeting });
            }, 1500);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthReady, knowledgeBase.length]);

    // --- Core LLM Logic ---
    const callGemini = useCallback(async (prompt, systemInstruction = null, generationConfig = null, tools = null) => {
        const payload = { contents: [{ parts: [{ text: prompt }] }], };
        if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };
        if (tools) payload.tools = tools;
        if (generationConfig) payload.generationConfig = generationConfig;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${geminiApiKey}`;
        for (let i = 0; i < 3; i++) {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                const result = await response.json();
                if (generationConfig && result.candidates?.[0]?.content?.parts?.[0]?.text) {
                    const jsonText = result.candidates[0].content.parts[0].text;
                    try { return JSON.parse(jsonText); } catch (e) { console.error("Failed to parse structured JSON response:", e); return null; }
                }
                const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!text) {
                    console.warn("Gemini response was empty or blocked.", result);
                    if (result.promptFeedback?.blockReason) return `My apologies, but I cannot respond to that due to: ${result.promptFeedback.blockReason}`;
                    return "Sorry, I received an empty response.";
                }
                return text;
            } catch (error) {
                if (i < 2) await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
                else { console.error('Gemini API call failed after retries:', error); return "An API error occurred. Check console for details."; }
            }
        }
    }, []);

    // --- Chat & Bot Helper Functions ---
    // --- MODIFIED: More robust ID generation ---
    const addMessage = (message) => {
        const newId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setChatHistory(prev => [...prev, {id: newId, ...message}]);
    };
    
    const updateLastMessage = (text) => {
         setChatHistory(prev => {
            const newHistory = [...prev];
            if (newHistory.length > 0) newHistory[newHistory.length - 1].text = text;
            return newHistory;
         });
    };

    const speak = (text) => {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        if (aiConfig.selectedVoiceName && availableVoices.length > 0) {
            const selectedVoice = availableVoices.find(v => v.name === aiConfig.selectedVoiceName);
            if (selectedVoice) utterance.voice = selectedVoice;
        }
        window.speechSynthesis.speak(utterance);
    };

    // --- Main Message Processor ---
    const processMessage = useCallback(async (query) => {
        if (query.trim() === '' || isGenerating) return;
        setIsGenerating(true);
        addMessage({ sender: 'user', text: query });
        setUserInput('');
        addMessage({ sender: 'bot', text: "..." });
        const webSearchTriggers = ['search for', 'what is', 'who is', 'when did', 'google', 'tell me about'];
        const queryLower = query.toLowerCase();
        const isWebSearch = webSearchTriggers.some(trigger => queryLower.startsWith(trigger));
        let systemPrompt = "";
        let fullPrompt = "";
        let tools = null;
        const baseSystemPrompt = `${aiConfig.persona} You should use a ${aiConfig.tone} tone. Keep your response text under ${aiConfig.maxLength} words.
            IMPORTANT: Do not use markdown, bullet points, or asterisks (*). You must present all lists as a single, natural paragraph.`;
        if (isWebSearch) {
            systemPrompt = baseSystemPrompt;
            fullPrompt = query; 
            tools = [{ "google_search": {} }]; 
        } else {
            systemPrompt = baseSystemPrompt;
            fullPrompt = `
                [KNOWLEDGE BASE (Locations)]
                ${JSON.stringify(knowledgeBase)}
                [END KNOWLEDGE BASE]
                
                [TODAY'S EVENTS (Name, Venue, & Time)]
                ${JSON.stringify(todayEvents)}
                [END TODAY'S EVENTS]
                
                You are a campus guide. You have two sets of data:
                1. A KNOWLEDGE BASE of all permanent locations.
                2. A list of TODAY'S EVENTS, which includes a time for each event.
                
                STRICT RULE: If the user asks about a location (e.g., "where is the library"), use the KNOWLEDGE BASE.
                STRICT RULE 2: If the user asks about "today's events", "what's happening", or asks about a specific event, use the TODAY'S EVENTS list. You must list the event name, its venue, and its time. If the list is empty, say "I don't see any events scheduled for today."
                STRICT RULE 3: If a user asks about events at a specific time (e.g., "any events this morning?", "what's happening at 2 PM?"), use the 'time' field in the TODAY'S EVENTS list to answer.
                FALLBACK RULE: For greetings, respond politely. For *any other question*, you MUST state that you can only provide information about campus locations and today's events.
                ABSOLUTE RULE: DO NOT search the web. DO NOT provide any external information.
                
                User Query: ${query}
            `;
            tools = null; 
        }
        const llmResponse = await callGemini(fullPrompt, systemPrompt, null, tools);
        let responseText = "Sorry, I had an error processing that. Please try again.";
        if (llmResponse && typeof llmResponse === 'string') {
            responseText = llmResponse;
        }
        updateLastMessage(responseText);
        speak(responseText);
        setIsGenerating(false);
    }, [isGenerating, aiConfig, knowledgeBase, todayEvents, callGemini, availableVoices]);

    // --- Optimizer AI (Upgrade) Logic ---
    const handleUpgradeAI = useCallback(async () => {
        if (!userId || !feedback || isUpgrading) return;
        setIsUpgrading(true);
        setUpgradeMessage("Optimizer AI is analyzing feedback...");
        const rootAISystemInstruction = `
            You are the Optimizer AI. Your task is to analyze user feedback and the AI's current configuration (DNA).
            Your ONLY output must be a valid JSON object adhering to the schema.
        `;
        const upgradePrompt = `
            Analyze the requirements and output the new, updated JSON configuration (DNA):
            ---
            **User Feedback:** "${feedback}"
            **Current DNA:** ${JSON.stringify(aiConfig, null, 2)}
            ---
        `;
        const generationConfig = {
            responseMimeType: "application/json",
            responseSchema: {
                type: "OBJECT",
                properties: { persona: { type: "STRING" }, tone: { type: "STRING" }, maxLength: { type: "NUMBER" }, },
                required: ["persona", "tone", "maxLength"]
            }
        };
        const newConfig = await callGemini(upgradePrompt, rootAISystemInstruction, generationConfig, null);
        if (!newConfig || typeof newConfig === 'string') {
            setUpgradeMessage("Error: Optimizer AI failed to return valid JSON. Please try again.");
        } else {
            const aiControlledConfig = {
                persona: newConfig.persona || aiConfig.persona,
                tone: newConfig.tone || aiConfig.tone,
                maxLength: newConfig.maxLength || aiConfig.maxLength,
            };
            const configDocRef = getAIConfigDocRef(db, userId);
            try {
                await setDoc(configDocRef, aiControlledConfig, { merge: true });
                setUpgradeMessage("Success! Bot DNA has been upgraded and saved to Firebase.");
                setFeedback('');
            } catch (e) {
                console.error("Firebase write error:", e);
                setUpgradeMessage("Error saving new DNA to Firebase.");
            }
        }
        setIsUpgrading(false);
    }, [userId, feedback, isUpgrading, aiConfig, callGemini, getAIConfigDocRef]);
    
    // --- Handle Voice Change ---
    const handleVoiceChange = async (e) => {
        const voiceName = e.target.value;
        if (!userId) return;
        const newVoicePref = voiceName === "" ? null : voiceName;
        setAiConfig(prevConfig => ({ ...prevConfig, selectedVoiceName: newVoicePref })); 
        const configDocRef = getAIConfigDocRef(db, userId);
        try {
            await setDoc(configDocRef, { selectedVoiceName: newVoicePref }, { merge: true });
        } catch (err) { console.error("Failed to save voice preference:", err); }
    };
    
    // --- Speech Recognition ---
    useEffect(() => {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'en-US';
        recognition.onstart = () => setIsListening(true);
        recognition.onend = () => setIsListening(false);
        recognition.onerror = (event) => console.error("Speech recognition error:", event.error);
        recognition.onresult = (event) => {
            const spokenText = event.results[0][0].transcript;
            setUserInput(spokenText);
            processMessage(spokenText);
        };
        recognitionRef.current = recognition;
    }, [processMessage]);
    
    const toggleListening = () => {
        if (isListening) recognitionRef.current?.stop();
        else recognitionRef.current?.start();
    };
    
    // --- Admin & Password Handlers ---
    const handleAdminClick = () => {
        if (isAdminUnlocked) setIsAdminPanelOpen(true);
        else setIsPasswordModalOpen(true);
    };

    const handlePasswordSubmit = () => {
        const ADMIN_PASSWORD = "admin123"; 
        if (passwordInput === ADMIN_PASSWORD) {
            setIsAdminUnlocked(true);
            setIsPasswordModalOpen(false);
            setIsAdminPanelOpen(true);
            setPasswordInput("");
            setPasswordError("");
        } else {
            setPasswordError("Incorrect password. Please try again.");
        }
    };

    const closeAdminPanel = () => {
        setIsAdminPanelOpen(false);
        setIsAdminUnlocked(false); 
    };

    // --- Event Management Handlers (with Time) ---
    const handleAddEvent = async () => {
        if (newEventName.trim() === "" || newEventVenue.trim() === "" || newEventTime.trim() === "") {
            alert("Please enter an event name, venue, and time.");
            return;
        }
        setIsEventUpdating(true);
        const newEvent = { name: newEventName, venue: newEventVenue, time: newEventTime };
        const updatedEvents = [...adminEventsList, newEvent];
        const eventDocRef = doc(db, 'campus_bot_events', adminSelectedDate);
        try {
            await setDoc(eventDocRef, { events: updatedEvents });
            setNewEventName("");
            setNewEventVenue("");
            setNewEventTime(""); 
        } catch (err) {
            console.error("Error adding event:", err);
            alert("Failed to add event.");
        }
        setIsEventUpdating(false);
    };

    const handleDeleteEvent = async (indexToDelete) => {
        setIsEventUpdating(true);
        const updatedEvents = adminEventsList.filter((_, index) => index !== indexToDelete);
        const eventDocRef = doc(db, 'campus_bot_events', adminSelectedDate);
        try {
            await setDoc(eventDocRef, { events: updatedEvents });
        } catch (err) {
            console.error("Error deleting event:", err);
            alert("Failed to delete event.");
        }
        setIsEventUpdating(false);
    };

    
    // --- Render ---
    if (!isAuthReady) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-gray-900">
                <Loader2 className="w-12 h-12 animate-spin text-white" />
                <p className="text-white text-lg ml-4">Authenticating with Firebase...</p>
            </div>
        );
    }
    
    return (
        <div className="h-screen w-screen bg-gray-900 text-white overflow-hidden flex flex-col items-center justify-center p-4">

            {/* Admin Button */}
            <button 
                onClick={handleAdminClick}
                className="absolute top-5 left-5 bg-gray-700 text-gray-200 px-4 py-2 rounded-lg font-semibold shadow-lg
                           flex items-center hover:bg-gray-600 transition-colors z-30"
            >
                <Settings size={18} className="mr-2" />
                Admin
            </button>
            
            {/* Password Modal */}
            {isPasswordModalOpen && (
                <div className="absolute inset-0 bg-black/50 z-40 flex items-center justify-center" onClick={() => setIsPasswordModalOpen(false)}>
                    <div
                        className="bg-white p-6 rounded-lg shadow-xl w-full max-w-sm text-gray-800"
                        onClick={e => e.stopPropagation()}
                    >
                        <h3 className="font-bold text-xl text-gray-800 mb-4">Admin Access</h3>
                        <label htmlFor="password-input" className="block text-sm font-medium text-gray-700">Password</label>
                        <input
                            id="password-input"
                            type="password"
                            className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-gray-900"
                            value={passwordInput}
                            onChange={e => setPasswordInput(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && handlePasswordSubmit()}
                        />
                        {passwordError && (
                            <p className="text-red-500 text-sm mt-2">{passwordError}</p>
                        )}
                        <button
                            onClick={handlePasswordSubmit}
                            className="mt-4 w-full bg-blue-600 text-white font-bold py-2 rounded shadow-md flex items-center justify-center"
                        >
                            Unlock
                        </button>
                    </div>
                </div>
            )}

            {/* Admin Panel */}
            {isAdminPanelOpen && (
                <div className="absolute inset-0 bg-black/50 z-40" onClick={closeAdminPanel}>
                    <div 
                        id="admin-panel" 
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-xl w-full max-w-md
                                   max-h-[90vh] overflow-y-auto text-gray-800"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-xl text-gray-800">Bot Settings</h3>
                            <button onClick={closeAdminPanel} className="text-gray-500 hover:text-gray-800">
                                <X size={24} />
                            </button>
                        </div>

                        {/* Event Management Section */}
                        <div className="pt-4 border-t border-gray-300">
                            <h4 className="font-semibold text-gray-700 mb-2 flex items-center"><CalendarDays size={16} className="mr-2" />Event Management</h4>
                            
                            <div className="mb-4">
                                <label htmlFor="event-date" className="block text-sm font-medium text-gray-700">Select Date to Edit</label>
                                <input
                                    type="date"
                                    id="event-date"
                                    className="mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-gray-900"
                                    value={adminSelectedDate}
                                    onChange={e => setAdminSelectedDate(e.target.value)}
                                />
                            </div>

                            <div className="space-y-2 mb-4">
                                <input 
                                    type="text"
                                    placeholder="Event Name"
                                    className="block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-gray-900"
                                    value={newEventName}
                                    onChange={e => setNewEventName(e.target.value)}
                                />
                                <input
                                    type="text"
                                    placeholder="Event Venue"
                                    className="block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-gray-900"
                                    value={newEventVenue}
                                    onChange={e => setNewEventVenue(e.target.value)}
                                />
                                <input
                                    type="text"
                                    placeholder="Event Time (e.g., 10:00 AM)"
                                    className="block w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-gray-900"
                                    value={newEventTime}
                                    onChange={e => setNewEventTime(e.target.value)}
                                />
                                <button
                                    onClick={handleAddEvent}
                                    disabled={isEventUpdating}
                                    className="w-full bg-green-600 text-white font-bold py-2 rounded shadow-md flex items-center justify-center disabled:opacity-50"
                                >
                                    {isEventUpdating ? <Loader2 className="w-5 h-5 animate-spin" /> : `Add Event for ${adminSelectedDate}`}
                                </button>
                            </div>
                            
                            <div className="max-h-32 overflow-y-auto space-y-2">
                                {adminEventsList.length === 0 ? (
                                    <p className="text-sm text-gray-500">No events scheduled for {adminSelectedDate}.</p>
                                ) : (
                                    adminEventsList.map((event, index) => (
                                        <div key={index} className="flex justify-between items-center bg-gray-100 p-2 rounded">
                                            <div>
                                                <p className="font-semibold text-sm text-gray-900">{event.name}</p>
                                                <p className="text-xs text-blue-700 font-medium">{event.time || "No time"}</p>
                                                <p className="text-xs text-gray-600">{event.venue}</p>
                                            </div>
                                            <button 
                                                onClick={() => handleDeleteEvent(index)}
                                                disabled={isEventUpdating}
                                                className="text-red-500 hover:text-red-700 disabled:opacity-50"
                                            >
                                                <X size={18} />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Bot DNA Settings */}
                        <div className="pt-4 border-t border-gray-300 mt-4">
                            <h4 className="font-semibold text-gray-700 mb-2 flex items-center"><Brain size={16} className="mr-2" />Bot DNA (from Firebase)</h4>
                            <pre className="text-xs font-mono bg-gray-100 p-3 rounded-lg border border-gray-200 text-gray-600 overflow-x-auto">
                                {JSON.stringify(aiConfig, null, 2)}
                            </pre>
                            
                            <div className="mt-4">
                                <label htmlFor="voice-select" className="block text-sm font-medium text-gray-700 flex items-center">
                                    <Volume2 size={16} className="mr-2" /> Bot Voice
                                </label>
                                <select
                                    id="voice-select"
                                    className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md text-gray-900"
                                    value={aiConfig.selectedVoiceName || ""}
                                    onChange={handleVoiceChange}
                                    disabled={availableVoices.length === 0}
                                >
                                    <option value="">
                                        {availableVoices.length === 0 ? "Loading voices..." : "Browser Default"}
                                    </option>
                                    {availableVoices.map((voice) => (
                                        <option key={voice.name} value={voice.name}>
                                            {voice.name} ({voice.lang})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Optimizer AI Feedback */}
                        <div className="pt-4 border-t border-gray-300 mt-4">
                            <h4 className="font-semibold text-gray-700 mb-2 flex items-center"><Cpu size={16} className="mr-2" />Optimizer AI (Persona)</h4>
                            {upgradeMessage && (
                                <div className={`mb-3 p-3 text-xs rounded-lg ${upgradeMessage.startsWith('Error') ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                    {upgradeMessage}
                                </div>
                            )}
                            <textarea 
                                id="feedback-input" 
                                rows="3" 
                                className="w-full p-2 border border-yellow-300 rounded-lg text-sm text-gray-900" 
                                placeholder="Feedback for Optimizer AI (e.g., 'Be more robotic', 'Make the tone more professional')."
                                value={feedback}
                                onChange={e => setFeedback(e.target.value)}
                            ></textarea>
                            <button 
                                id="upgrade-ai-btn"
                                onClick={handleUpgradeAI}
                                disabled={isUpgrading || !feedback}
                                className="mt-2 w-full bg-yellow-500 text-white font-bold py-2 rounded shadow-md flex items-center justify-center
                                           disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isUpgrading ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        <Cpu size={18} className="mr-2" />
                                        Upgrade Bot DNA
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Chat UI */}
            <div className="w-full max-w-2xl bg-gray-800 shadow-2xl rounded-2xl flex flex-col h-full max-h-[90vh] text-white overflow-hidden border border-gray-700">
                <div className="p-4 border-b border-gray-700 text-center">
                    <h2 className="text-2xl font-bold flex items-center justify-center"><Bot className="mr-2"/> Campus Bot</h2>
                    <p className="text-sm text-gray-400">Your AI-powered campus guide</p>
                </div>
                <div ref={chatHistoryRef} id="chat-history" className="flex-1 p-4 overflow-y-auto flex flex-col space-y-3">
                    {chatHistory.map((msg) => (
                        <div 
                            key={msg.id}
                            className={`chat-bubble max-w-[85%] py-3 px-4 rounded-2xl ${
                                msg.sender === 'user' 
                                ? 'bg-blue-600 text-white self-end rounded-br-none' 
                                : 'bg-gray-700 text-gray-100 self-start rounded-bl-none'
                            }`}
                        >
                            {msg.text}
                        </div>
                    ))}
                </div>
                <div className="p-4 border-t border-gray-700">
                    <div className="flex">
                        <input 
                            type="text" 
                            id="user-input"
                            className="flex-1 text-lg border border-gray-600 bg-gray-700 rounded-l-xl p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-gray-400 text-white" 
                            placeholder="Type or use the mic..."
                            value={userInput}
                            onChange={e => setUserInput(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && processMessage(userInput)}
                            disabled={isGenerating}
                        />
                        <button 
                            id="send-btn"
                            className="bg-blue-600 text-white px-5 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                            onClick={() => processMessage(userInput)}
                            disabled={isGenerating || !userInput.trim()}
                        >
                            <Send size={24} />
                        </button>
                        <button 
                            id="mic-btn"
                            className={`text-white px-5 rounded-r-xl ml-1 transition-all ${
                                isListening 
                                ? 'bg-red-500 scale-110' 
                                : 'bg-gray-600 hover:bg-gray-500'
                            } focus:outline-none focus:ring-2 focus:ring-gray-500`}
                            onClick={toggleListening}
                        >
                            <Mic size={28} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}