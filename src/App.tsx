import React, { useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface Participant {
  id: number;
  name: string;
  has_confessed: boolean;
}

interface ConfessionInput {
  target_id: number;
  confession_text: string;
}

export default function App() {
  const [view, setView] = useState<'landing' | 'lobby' | 'pass-device' | 'writing' | 'results' | 'finished'>('landing');
  const [activeSubView, setActiveSubView] = useState<'create' | 'join' | null>(null);
  
  // Form States
  const [roomName, setRoomName] = useState('');
  const [roomPassword, setRoomPassword] = useState('');
  const [newParticipantCount, setNewParticipantCount] = useState<number>(6);
  
  // Game States
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentUserIdx, setCurrentUserIdx] = useState<number>(-1);
  const [confessionsToWrite, setConfessionsToWrite] = useState<Record<number, string>>({});
  
  // Results State
  const [resultsData, setResultsData] = useState<Record<string, string[]>>({});
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null);

  // App feedback
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Helper: Reset errors
  const resetError = () => setApiError(null);

  // Flow: Verify room & password to either write or view results
  const handleVerifyRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName || !roomPassword) return;
    
    setLoading(true);
    resetError();
    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: roomName, password: roomPassword }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to connect to room');
      }
      
      const roomStatus = await response.json();
      setParticipants(roomStatus.participants);
      
      if (roomStatus.status === 'completed') {
        // Fetch results directly
        fetchResults(roomName, roomPassword);
      } else {
        // Find the first participant who hasn't confessed yet
        const nextIdx = roomStatus.participants.findIndex((p: Participant) => !p.has_confessed);
        if (nextIdx !== -1) {
          setCurrentUserIdx(nextIdx);
          setView('pass-device');
        } else {
          setView('finished');
        }
      }
    } catch (err: any) {
      setApiError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Flow: Create Room Setup (Go to lobby configuration)
  const handleStartRoomCreation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName || !roomPassword) return;
    
    // Generate initial participant array based on count
    const list: Participant[] = [];
    for (let i = 1; i <= newParticipantCount; i++) {
      list.push({ id: i, name: `Person ${i}`, has_confessed: false });
    }
    setParticipants(list);
    setView('lobby');
    resetError();
  };

  // Lobby: Add Participant
  const addParticipant = () => {
    const newId = participants.length > 0 ? Math.max(...participants.map(p => p.id)) + 1 : 1;
    setParticipants([
      ...participants,
      { id: newId, name: `Person ${newId}`, has_confessed: false }
    ]);
  };

  // Lobby: Remove Participant
  const removeParticipant = (id: number) => {
    if (participants.length <= 2) {
      setApiError("A room must have at least 2 participants.");
      return;
    }
    setParticipants(participants.filter(p => p.id !== id));
  };

  // Lobby: Update Participant Name
  const updateParticipantName = (id: number, newName: string) => {
    setParticipants(
      participants.map(p => (p.id === id ? { ...p, name: newName } : p))
    );
  };

  // Lobby: Finalize & Submit Lobby configuration to server
  const handleFinalizeRoom = async () => {
    // Validate names are unique and not empty
    const names = participants.map(p => p.name.trim());
    if (names.some(name => !name)) {
      setApiError("Participant names cannot be empty.");
      return;
    }
    if (new Set(names).size !== names.length) {
      setApiError("Participant names must be unique.");
      return;
    }

    setLoading(true);
    resetError();
    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: roomName,
          password: roomPassword,
          participant_names: names
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to create room');
      }

      const createdRoom = await response.json();
      setParticipants(createdRoom.participants);
      setCurrentUserIdx(0);
      setView('pass-device');
    } catch (err: any) {
      setApiError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Writing: Submit confessions from current user
  const handleSubmitConfessions = async () => {
    const currentParticipant = participants[currentUserIdx];
    const confessionsPayload: ConfessionInput[] = [];

    // Compile inputs
    participants.forEach(p => {
      if (p.id !== currentParticipant.id) {
        const text = confessionsToWrite[p.id] || '';
        confessionsPayload.push({
          target_id: p.id,
          confession_text: text
        });
      }
    });

    setLoading(true);
    resetError();
    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms/${roomName}/confessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Room-Password': roomPassword
        },
        body: JSON.stringify({
          from_participant_id: currentParticipant.id,
          confessions: confessionsPayload
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to submit confessions');
      }

      // Confession accepted, clear working buffers
      setConfessionsToWrite({});
      
      // Update local status of participant confession
      const updatedParticipants = participants.map((p, idx) => 
        idx === currentUserIdx ? { ...p, has_confessed: true } : p
      );
      setParticipants(updatedParticipants);

      // Find next player who hasn't confessed
      const nextIdx = updatedParticipants.findIndex(p => !p.has_confessed);
      if (nextIdx !== -1) {
        setCurrentUserIdx(nextIdx);
        setView('pass-device');
      } else {
        setView('finished');
      }
    } catch (err: any) {
      setApiError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Results: Fetch complete confessions lists
  const fetchResults = async (name: string, pass: string) => {
    setLoading(true);
    resetError();
    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms/${name}/results`, {
        method: 'GET',
        headers: {
          'X-Room-Password': pass
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to retrieve results');
      }

      const data = await response.json();
      setResultsData(data.results);
      
      // Select first participant by default
      const names = Object.keys(data.results);
      if (names.length > 0) {
        setSelectedParticipant(names[0]);
      }
      setView('results');
    } catch (err: any) {
      setApiError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExitRoom = () => {
    setView('landing');
    setActiveSubView(null);
    setRoomName('');
    setRoomPassword('');
    setParticipants([]);
    setResultsData({});
    setSelectedParticipant(null);
    resetError();
  };

  // Render components
  return (
    <main className="container fade-in">
      {/* Top Header */}
      <header style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🔮</div>
        <h1 className="gradient-title" style={{ fontSize: '2.25rem', marginBottom: '0.5rem' }}>
          Incognito Thoughts
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          Constructive, completely anonymous confession spaces for positive self-improvement.
        </p>
      </header>

      {/* Error Banner */}
      {apiError && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid var(--error-color)',
          borderRadius: '12px',
          padding: '1rem',
          marginBottom: '1.5rem',
          color: '#FCA5A5',
          fontSize: '0.95rem',
          textAlign: 'left'
        }}>
          <strong>Error: </strong> {apiError}
        </div>
      )}

      {/* VIEW: Landing Screen */}
      {view === 'landing' && (
        <section>
          <div style={{ textAlign: 'left', marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.4rem', color: 'var(--accent-purple-light)', marginBottom: '0.75rem' }}>
              Why Play?
            </h2>
            <ul className="rules-list">
              <li>Receive anonymous insights from your peers to identify habits you can work on.</li>
              <li>Learn how others perceive you in a safe, constructive space.</li>
              <li>Reflect on constructive criticism and improve yourself positively.</li>
              <li>Ensure all feedback and confessions are genuine, helpful, and respectful.</li>
            </ul>
          </div>

          {!activeSubView && (
            <div className="btn-group">
              <button 
                onClick={() => { setActiveSubView('create'); resetError(); }}
                className="btn btn-primary"
                id="btn-trigger-create"
              >
                Create Room
              </button>
              <button 
                onClick={() => { setActiveSubView('join'); resetError(); }}
                className="btn btn-secondary"
                id="btn-trigger-view"
              >
                View Room Results
              </button>
            </div>
          )}

          {activeSubView === 'create' && (
            <form onSubmit={handleStartRoomCreation} className="fade-in">
              <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', color: 'var(--accent-pink-light)' }}>
                Create a New Room
              </h3>
              
              <div className="form-group">
                <label className="form-label" htmlFor="room-name-create">Unique Room Name</label>
                <input 
                  type="text" 
                  id="room-name-create"
                  className="form-input" 
                  placeholder="e.g. FridayFriends"
                  required
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="room-pwd-create">Room Password (required to reveal results)</label>
                <input 
                  type="password" 
                  id="room-pwd-create"
                  className="form-input" 
                  placeholder="••••••••"
                  required
                  value={roomPassword}
                  onChange={(e) => setRoomPassword(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="room-count-create">Number of Participants</label>
                <select 
                  id="room-count-create"
                  className="form-input"
                  value={newParticipantCount}
                  onChange={(e) => setNewParticipantCount(Number(e.target.value))}
                >
                  {[2,3,4,5,6,7,8,9,10,11,12,13,14,15,20,25,30].map(n => (
                    <option key={n} value={n}>{n} People</option>
                  ))}
                </select>
              </div>

              <div className="btn-group">
                <button type="submit" className="btn btn-primary">
                  Proceed to Lobby
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setActiveSubView(null)}>
                  Back
                </button>
              </div>
            </form>
          )}

          {activeSubView === 'join' && (
            <form onSubmit={handleVerifyRoom} className="fade-in">
              <h3 style={{ marginBottom: '1.5rem', fontSize: '1.25rem', color: 'var(--accent-purple-light)' }}>
                Enter Room Details
              </h3>
              
              <div className="form-group">
                <label className="form-label" htmlFor="room-name-join">Room Name</label>
                <input 
                  type="text" 
                  id="room-name-join"
                  className="form-input" 
                  placeholder="e.g. FridayFriends"
                  required
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="room-pwd-join">Room Password</label>
                <input 
                  type="password" 
                  id="room-pwd-join"
                  className="form-input" 
                  placeholder="••••••••"
                  required
                  value={roomPassword}
                  onChange={(e) => setRoomPassword(e.target.value)}
                />
              </div>

              <div className="btn-group">
                <button type="submit" disabled={loading} className="btn btn-primary">
                  {loading ? 'Verifying...' : 'Access Room'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setActiveSubView(null)}>
                  Back
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {/* VIEW: Lobby View */}
      {view === 'lobby' && (
        <section className="fade-in">
          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem', color: 'var(--accent-purple-light)' }}>
            Configure Lobby Names
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Customize the names of participants, add new players, or remove any before launching confessions.
          </p>

          <div className="participant-list">
            {participants.map((p, idx) => (
              <div key={p.id} className="participant-item">
                <div className="participant-name-wrapper">
                  <div className="participant-number">{idx + 1}</div>
                  <input 
                    type="text" 
                    className="participant-input" 
                    value={p.name}
                    placeholder="Enter name"
                    onChange={(e) => updateParticipantName(p.id, e.target.value)}
                  />
                </div>
                <button 
                  type="button" 
                  className="remove-btn" 
                  onClick={() => removeParticipant(p.id)}
                  title="Remove participant"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
            <button type="button" onClick={addParticipant} className="btn btn-secondary" style={{ flex: 1 }}>
              + Add Person
            </button>
          </div>

          <div className="btn-group">
            <button 
              type="button" 
              onClick={handleFinalizeRoom} 
              disabled={loading} 
              className="btn btn-primary"
            >
              {loading ? 'Starting...' : 'Start Confessions'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={handleExitRoom}>
              Cancel Room
            </button>
          </div>
        </section>
      )}

      {/* VIEW: Pass Device view */}
      {view === 'pass-device' && currentUserIdx !== -1 && (
        <section className="fade-in" style={{ textAlign: 'center', padding: '2rem 0' }}>
          <div className="status-pill">
            Turn {currentUserIdx + 1} of {participants.length}
          </div>
          
          <h2 style={{ fontSize: '1.8rem', margin: '1rem 0', color: 'var(--text-primary)' }}>
            Pass the device to:
          </h2>
          
          <div style={{
            fontSize: '2.5rem',
            fontWeight: 'bold',
            background: 'var(--gradient-text)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            margin: '1.5rem 0',
            textShadow: '0 4px 10px rgba(139, 92, 246, 0.2)'
          }}>
            {participants[currentUserIdx]?.name}
          </div>

          <p style={{ color: 'var(--text-secondary)', maxWidth: '400px', margin: '0 auto 2.5rem auto' }}>
            To keep your confessions secret, ensure other players cannot view your screen, then click below to write your confessions.
          </p>

          <button 
            type="button" 
            onClick={() => setView('writing')} 
            className="btn btn-primary"
            style={{ width: '100%', maxWidth: '320px' }}
          >
            Start My Turn
          </button>
        </section>
      )}

      {/* VIEW: Writing View */}
      {view === 'writing' && currentUserIdx !== -1 && (
        <section className="fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div className="status-pill">
              Confessing as: {participants[currentUserIdx]?.name}
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              Turn {currentUserIdx + 1} / {participants.length}
            </span>
          </div>

          <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Write Confessions</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '2rem' }}>
            Add thoughts about other players. If you don't wish to confess about someone, leave it blank (it will be skipped).
          </p>

          <div style={{ maxHeight: '420px', overflowY: 'auto', paddingRight: '0.5rem', marginBottom: '1.5rem' }}>
            {participants
              .filter(p => p.id !== participants[currentUserIdx].id)
              .map(p => (
                <div key={p.id} className="confess-item">
                  <label className="confess-header" htmlFor={`confession-${p.id}`}>
                    About <span>{p.name}</span>:
                  </label>
                  <textarea
                    id={`confession-${p.id}`}
                    className="form-input"
                    placeholder="Enter confession..."
                    style={{ minHeight: '80px', resize: 'vertical', background: 'rgba(0,0,0,0.2)' }}
                    value={confessionsToWrite[p.id] || ''}
                    onChange={(e) => setConfessionsToWrite({
                      ...confessionsToWrite,
                      [p.id]: e.target.value
                    })}
                  />
                  <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    Leave blank to skip
                  </div>
                </div>
              ))}
          </div>

          <button 
            type="button" 
            onClick={handleSubmitConfessions} 
            disabled={loading} 
            className="btn btn-primary"
            style={{ width: '100%' }}
          >
            {loading ? 'Submitting...' : 'Submit and Next'}
          </button>
        </section>
      )}

      {/* VIEW: Finished View */}
      {view === 'finished' && (
        <section className="fade-in" style={{ textAlign: 'center', padding: '2rem 0' }}>
          <div style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>🏁</div>
          <h2 style={{ fontSize: '2rem', marginBottom: '1rem', color: 'var(--success-color)' }}>
            All Set!
          </h2>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '450px', margin: '0 auto 2.5rem auto' }}>
            All participants have submitted their confessions. The room is now sealed and compiled.
          </p>

          <div className="btn-group btn-group-center" style={{ flexDirection: 'column', maxWidth: '320px', margin: '0 auto' }}>
            <button 
              type="button" 
              onClick={() => fetchResults(roomName, roomPassword)} 
              disabled={loading} 
              className="btn btn-primary"
              style={{ width: '100%' }}
            >
              {loading ? 'Loading...' : 'Reveal Results'}
            </button>
            <button 
              type="button" 
              onClick={handleExitRoom} 
              className="btn btn-secondary"
              style={{ width: '100%' }}
            >
              Back to Home
            </button>
          </div>
        </section>
      )}

      {/* VIEW: Results View */}
      {view === 'results' && (
        <section className="fade-in">
          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.25rem', color: 'var(--accent-purple-light)' }}>
            Confessions Revealed
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
            Room: <strong style={{ color: 'var(--text-primary)' }}>{roomName}</strong>
          </p>

          {/* Selector Dropdown */}
          <div className="form-group">
            <label className="form-label" htmlFor="results-select-person">Select a Person to view confessions about them:</label>
            <select
              id="results-select-person"
              className="form-input"
              value={selectedParticipant || ''}
              onChange={(e) => setSelectedParticipant(e.target.value)}
            >
              {Object.keys(resultsData).map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>

          {/* Results display box */}
          {selectedParticipant && (
            <div className="result-card fade-in" key={selectedParticipant}>
              <div className="result-name">About {selectedParticipant}</div>
              
              {resultsData[selectedParticipant]?.length > 0 ? (
                <ul className="confession-list">
                  {resultsData[selectedParticipant].map((text, idx) => (
                    <li key={idx} className="confession-text fade-in" style={{ animationDelay: `${idx * 0.05}s` }}>
                      {text}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="no-confessions">
                  No confessions for you. Apparently, no one cares about you.
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: '2.5rem' }}>
            <button type="button" onClick={handleExitRoom} className="btn btn-secondary" style={{ width: '100%' }}>
              Exit Room & Return Home
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
