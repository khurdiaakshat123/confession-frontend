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

interface ConfessionResultItem {
  id: number;
  confession_text: string;
  agree_count: number;
  not_agree_count: number;
  cant_comment_count: number;
}

export default function App() {
  const [view, setView] = useState<'landing' | 'lobby' | 'pass-device' | 'writing' | 'results' | 'finished' | 'pass-device-endorse' | 'writing-endorse'>('landing');
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
  const [resultsData, setResultsData] = useState<Record<string, ConfessionResultItem[]>>({});
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null);

  // Post-Game management states
  const [newPostParticipantName, setNewPostParticipantName] = useState('');

  // Endorsements state
  const [endorseTargetName, setEndorseTargetName] = useState<string | null>(null);
  const [endorseVoters, setEndorseVoters] = useState<Participant[]>([]);
  const [endorseVoterIdx, setEndorseVoterIdx] = useState<number>(-1);
  const [endorseVotes, setEndorseVotes] = useState<Record<number, string>>({}); // confessionId -> vote

  // Rules Modal toggle
  const [showRulesModal, setShowRulesModal] = useState(false);

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
        fetchResults(roomName, roomPassword);
      } else {
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

      setConfessionsToWrite({});
      
      const updatedParticipants = participants.map((p, idx) => 
        idx === currentUserIdx ? { ...p, has_confessed: true } : p
      );
      setParticipants(updatedParticipants);

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

  // Post-Game: Delete Participant
  const handleDeletePostParticipant = async (id: number) => {
    if (participants.length <= 2) {
      setApiError("A room must have at least 2 participants.");
      return;
    }
    setLoading(true);
    resetError();
    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms/${roomName}/participants/${id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Room-Password': roomPassword
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to delete participant');
      }

      const updatedRoom = await response.json();
      setParticipants(updatedRoom.participants);
      
      if (updatedRoom.status === 'collecting') {
        const nextIdx = updatedRoom.participants.findIndex((p: Participant) => !p.has_confessed);
        if (nextIdx !== -1) {
          setCurrentUserIdx(nextIdx);
          setView('pass-device');
        }
      }
    } catch (err: any) {
      setApiError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Post-Game: Add Participant
  const handleAddPostParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPostParticipantName.trim()) return;

    setLoading(true);
    resetError();
    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms/${roomName}/participants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Room-Password': roomPassword
        },
        body: JSON.stringify({ name: newPostParticipantName.trim() })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to add participant');
      }

      const updatedRoom = await response.json();
      setParticipants(updatedRoom.participants);
      setNewPostParticipantName('');

      const nextIdx = updatedRoom.participants.findIndex((p: Participant) => !p.has_confessed);
      if (nextIdx !== -1) {
        setCurrentUserIdx(nextIdx);
        setView('pass-device');
      }
    } catch (err: any) {
      setApiError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Endorsements: Initialize the loop
  const handleStartEndorsementRound = () => {
    if (!selectedParticipant) return;
    const targetConfessions = resultsData[selectedParticipant] || [];
    if (targetConfessions.length === 0) {
      setApiError(`Cannot run endorsements for ${selectedParticipant} because they have no confessions.`);
      return;
    }

    resetError();
    setEndorseTargetName(selectedParticipant);
    
    // Voters: all participants EXCEPT the target person
    const votersList = participants.filter(p => p.name !== selectedParticipant);
    setEndorseVoters(votersList);
    setEndorseVoterIdx(0);
    setEndorseVotes({});
    setView('pass-device-endorse');
  };

  // Endorsements: Submit individual voter turn
  const handleSubmitVoterEndorsements = async () => {
    const targetConfessions = resultsData[endorseTargetName!] || [];
    
    // Build payload of votes for backend
    const votesPayload = targetConfessions.map(c => ({
      confession_id: c.id,
      vote: endorseVotes[c.id] || 'cant_comment'
    }));

    setLoading(true);
    resetError();
    try {
      const response = await fetch(`${API_BASE_URL}/api/rooms/${roomName}/endorsements`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Room-Password': roomPassword
        },
        body: JSON.stringify({ votes: votesPayload })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to submit endorsements');
      }

      // Reset voter selection state
      setEndorseVotes({});

      // Move to next voter
      const nextVoterIdx = endorseVoterIdx + 1;
      if (nextVoterIdx < endorseVoters.length) {
        setEndorseVoterIdx(nextVoterIdx);
        setView('pass-device-endorse');
      } else {
        // All voters completed! Reload results to see updated tallies
        await fetchResults(roomName, roomPassword);
      }
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
    setNewPostParticipantName('');
    setEndorseTargetName(null);
    setEndorseVoters([]);
    setEndorseVoterIdx(-1);
    setEndorseVotes({});
    resetError();
  };

  // Static rules content
  const renderRules = () => (
    <div style={{ textAlign: 'left' }}>
      <h2 style={{ fontSize: '1.4rem', color: 'var(--accent-pink-light)', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.5rem' }}>
        Reflections & Feedback Guidelines
      </h2>
      <p style={{ color: 'var(--text-primary)', fontSize: '0.95rem', marginBottom: '1rem' }}>
        Incognito Thoughts is designed to cultivate self-improvement and positive peer-to-peer reflections.
      </p>
      <ul className="rules-list">
        <li><strong>Constructive Purpose:</strong> This game helps you see how you are perceived by others. Use this feedback to identify habits you can refine, and grow.</li>
        <li><strong>Positive Reflections:</strong> Take feedback in a positive way. It is a mirror for personal growth rather than a source of conflict.</li>
        <li><strong>Genuine Confessions:</strong> Only write honest, respectful, and genuine reflections. Cruelty is discouraged; focus on constructive, helpful inputs.</li>
        <li><strong>Endorsements Flow:</strong> After compiling confessions, you can endorse confessions for any person. Everyone in the lobby (except the subject) will privately vote on whether they agree, disagree, or have no comment on each confession.</li>
      </ul>
    </div>
  );

  return (
    <main className="container fade-in">
      {/* Top Header */}
      <header style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🔮</div>
        <h1 className="gradient-title" style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>
          Incognito Thoughts
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>
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
          {/* Rules and positive-habit copy */}
          <div style={{ textAlign: 'left', marginBottom: '2.5rem' }}>
            <h2 style={{ fontSize: '1.6rem', color: 'var(--accent-purple-light)', marginBottom: '1rem' }}>
              Fostering Constructive Reflections
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', marginBottom: '1.5rem' }}>
              Anonymous reflections let you see how you are perceived by friends or peers. Use these insights to identify habits you can refine, improve self-awareness, and grow in a positive direction.
            </p>
            <ul className="rules-list">
              <li>Receive honest and genuine anonymous confessions point-by-point.</li>
              <li>Participate in a local group by passing the screen in complete privacy.</li>
              <li>Endorse confessions: gather consensus from the room anonymously.</li>
            </ul>
          </div>

          {!activeSubView && (
            <div className="btn-group">
              <button 
                onClick={() => { setActiveSubView('create'); resetError(); }}
                className="btn btn-primary"
                id="btn-trigger-create"
                style={{ fontSize: '1.1rem' }}
              >
                Create Room
              </button>
              <button 
                onClick={() => { setActiveSubView('join'); resetError(); }}
                className="btn btn-secondary"
                id="btn-trigger-view"
                style={{ fontSize: '1.1rem' }}
              >
                View Room Results
              </button>
            </div>
          )}

          {activeSubView === 'create' && (
            <form onSubmit={handleStartRoomCreation} className="fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1.4rem', color: 'var(--accent-pink-light)' }}>
                  Create a New Room
                </h3>
                <button 
                  type="button" 
                  onClick={() => setShowRulesModal(true)} 
                  className="btn btn-info"
                  style={{ padding: '0.5rem 1rem', borderRadius: '10px', fontSize: '0.85rem' }}
                >
                  View Rules
                </button>
              </div>
              
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
              <h3 style={{ marginBottom: '1.5rem', fontSize: '1.4rem', color: 'var(--accent-purple-light)' }}>
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

      {/* VIEW: Lobby View (Uses spacious split-layout) */}
      {view === 'lobby' && (
        <section className="fade-in">
          <div className="split-layout">
            <div>
              <h2 style={{ fontSize: '1.8rem', marginBottom: '0.75rem', color: 'var(--accent-purple-light)' }}>
                Configure Lobby Names
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '1.5rem' }}>
                Enter the names of everyone playing. You can add or remove people using the controls on the right. 
              </p>
              
              <div style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--panel-border)',
                borderRadius: '16px',
                padding: '1.5rem',
                textAlign: 'left',
                marginTop: '2rem'
              }}>
                <h4 style={{ color: 'var(--accent-pink-light)', marginBottom: '0.5rem' }}>Rules Reminder</h4>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  Once the round starts, each player will privately submit confessions for the rest of the lobby. Names must be unique.
                </p>
              </div>

              <div className="btn-group" style={{ marginTop: '2.5rem' }}>
                <button 
                  type="button" 
                  onClick={handleFinalizeRoom} 
                  disabled={loading} 
                  className="btn btn-primary"
                >
                  {loading ? 'Starting...' : 'Start Confessions'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleExitRoom}>
                  Cancel
                </button>
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <span style={{ fontWeight: '600', color: 'var(--text-secondary)' }}>Lobby Members ({participants.length})</span>
                <button type="button" onClick={addParticipant} className="btn btn-info" style={{ padding: '0.4rem 1rem', borderRadius: '10px', fontSize: '0.85rem' }}>
                  + Add Person
                </button>
              </div>

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
            </div>
          </div>
        </section>
      )}

      {/* VIEW: Pass Device view */}
      {view === 'pass-device' && currentUserIdx !== -1 && (
        <section className="fade-in" style={{ textAlign: 'center', padding: '3rem 0' }}>
          <div className="status-pill">
            Turn {currentUserIdx + 1} of {participants.length}
          </div>
          
          <h2 style={{ fontSize: '2.2rem', margin: '1rem 0', color: 'var(--text-primary)' }}>
            Pass the device to:
          </h2>
          
          <div style={{
            fontSize: '3.5rem',
            fontWeight: 'bold',
            background: 'var(--gradient-text)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            margin: '2rem 0',
            textShadow: '0 6px 15px rgba(139, 92, 246, 0.25)'
          }}>
            {participants[currentUserIdx]?.name}
          </div>

          <p style={{ color: 'var(--text-secondary)', maxWidth: '500px', margin: '0 auto 3rem auto', fontSize: '1.05rem' }}>
            Ensure other players cannot view your screen. When you are ready, click below to log your anonymous thoughts.
          </p>

          <button 
            type="button" 
            onClick={() => setView('writing')} 
            className="btn btn-primary"
            style={{ width: '100%', maxWidth: '360px', fontSize: '1.1rem' }}
          >
            Start My Turn
          </button>
        </section>
      )}

      {/* VIEW: Writing View (Uses spacious split-layout) */}
      {view === 'writing' && currentUserIdx !== -1 && (
        <section className="fade-in">
          <div className="split-layout">
            <div>
              <div className="status-pill">
                Active Player: {participants[currentUserIdx]?.name}
              </div>
              
              <h2 style={{ fontSize: '1.8rem', marginTop: '0.5rem', marginBottom: '1rem' }}>
                Your Confessions
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', marginBottom: '1.5rem', lineHeight: '1.6' }}>
                Write confessions, feedback, or observations about the other players in the lobby. 
              </p>
              
              <div style={{
                background: 'rgba(139, 92, 246, 0.04)',
                border: '1px solid rgba(139, 92, 246, 0.15)',
                borderRadius: '16px',
                padding: '1.5rem',
                textAlign: 'left',
                margin: '2rem 0'
              }}>
                <h4 style={{ color: 'var(--accent-purple-light)', marginBottom: '0.5rem' }}>Reminder:</h4>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  If you leave a box empty, it will be skipped entirely. Your name will not be linked to any of these entries.
                </p>
              </div>

              <button 
                type="button" 
                onClick={handleSubmitConfessions} 
                disabled={loading} 
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '1.5rem' }}
              >
                {loading ? 'Submitting...' : 'Submit My Confessions'}
              </button>
            </div>

            <div>
              <span style={{ fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '1rem', textAlign: 'right' }}>
                Step {currentUserIdx + 1} of {participants.length}
              </span>
              
              <div style={{ maxHeight: '450px', overflowY: 'auto', paddingRight: '0.5rem' }}>
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
                        placeholder="e.g. You handle pressure really well, it helps the team stay calm."
                        style={{ minHeight: '80px', resize: 'vertical' }}
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
            </div>
          </div>
        </section>
      )}

      {/* VIEW: Finished View (Allows adding/deleting members just before showing result) */}
      {view === 'finished' && (
        <section className="fade-in">
          <div className="split-layout">
            <div>
              <div style={{ fontSize: '4.5rem', marginBottom: '1rem' }}>🏁</div>
              <h2 style={{ fontSize: '2rem', marginBottom: '1rem', color: 'var(--success-color)' }}>
                Confessions Compiled!
              </h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', marginBottom: '2rem', lineHeight: '1.6' }}>
                All participants have submitted their confessions. Before you reveal the results, you can review the active room members on the right.
              </p>
              
              <div style={{
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.15)',
                borderRadius: '16px',
                padding: '1.5rem',
                textAlign: 'left',
                marginBottom: '2rem'
              }}>
                <h4 style={{ color: '#FCA5A5', marginBottom: '0.5rem' }}>Attention:</h4>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  If you **add a member** now, the room will unlock, and the new member must log their confessions before results are compiled. Deleting a member removes them and their associated feedback permanently.
                </p>
              </div>

              <div className="btn-group" style={{ flexDirection: 'column' }}>
                <button 
                  type="button" 
                  onClick={() => fetchResults(roomName, roomPassword)} 
                  disabled={loading} 
                  className="btn btn-primary"
                  style={{ width: '100%', fontSize: '1.1rem' }}
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
            </div>

            <div>
              <h3 style={{ fontSize: '1.25rem', marginBottom: '1rem', color: 'var(--accent-purple-light)' }}>
                Manage Room Participants
              </h3>
              
              {/* Add member form */}
              <form onSubmit={handleAddPostParticipant} style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Add new person..."
                  style={{ padding: '0.65rem 1rem' }}
                  value={newPostParticipantName}
                  onChange={(e) => setNewPostParticipantName(e.target.value)}
                />
                <button type="submit" disabled={loading} className="btn btn-info" style={{ padding: '0.65rem 1.25rem', borderRadius: '12px' }}>
                  + Add
                </button>
              </form>

              {/* Members list */}
              <div className="manage-list">
                {participants.map(p => (
                  <div key={p.id} className="manage-item">
                    <span className="manage-item-name">{p.name}</span>
                    <button 
                      type="button" 
                      disabled={loading}
                      onClick={() => handleDeletePostParticipant(p.id)}
                      className="btn btn-danger"
                      style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', borderRadius: '8px' }}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* VIEW: Results View (Uses split-layout and lists endorsement stats) */}
      {view === 'results' && (
        <section className="fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.8rem', color: 'var(--accent-purple-light)' }}>
                Confessions Revealed
              </h2>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Room: <strong>{roomName}</strong>
              </span>
            </div>
            <button type="button" onClick={handleExitRoom} className="btn btn-secondary">
              Exit Room
            </button>
          </div>

          <div className="split-layout">
            {/* Sidebar list of participants */}
            <div>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>Select Participant</h3>
              <div className="results-sidebar" style={{ marginBottom: '1.5rem' }}>
                {Object.keys(resultsData).map(name => (
                  <div 
                    key={name}
                    className={`sidebar-item ${selectedParticipant === name ? 'active' : ''}`}
                    onClick={() => setSelectedParticipant(name)}
                  >
                    <span>{name}</span>
                    <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>
                      ({resultsData[name]?.length || 0} feedback)
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Display panel */}
            <div>
              {selectedParticipant ? (
                <div className="result-card" key={selectedParticipant}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: '0.75rem' }}>
                    <div className="result-name" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
                      Thoughts About {selectedParticipant}
                    </div>
                    {resultsData[selectedParticipant]?.length > 0 && (
                      <button 
                        type="button" 
                        onClick={handleStartEndorsementRound}
                        className="btn btn-info"
                        style={{ padding: '0.4rem 1rem', borderRadius: '10px', fontSize: '0.85rem' }}
                      >
                        Endorse Feedback
                      </button>
                    )}
                  </div>
                  
                  {resultsData[selectedParticipant]?.length > 0 ? (
                    <ul className="confession-list">
                      {resultsData[selectedParticipant].map((item, idx) => (
                        <li key={item.id} className="confession-text fade-in" style={{ animationDelay: `${idx * 0.05}s`, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <div>{item.confession_text}</div>
                          
                          {/* Endorsements Tally Display */}
                          <div style={{
                            display: 'flex',
                            gap: '0.75rem',
                            fontSize: '0.8rem',
                            color: 'var(--text-secondary)',
                            background: 'rgba(0, 0, 0, 0.25)',
                            padding: '0.25rem 0.6rem',
                            borderRadius: '6px',
                            alignSelf: 'flex-start',
                            border: '1px solid rgba(255, 255, 255, 0.03)'
                          }}>
                            <span>👍 Agree: <strong>{item.agree_count}</strong></span>
                            <span>👎 Not Agree: <strong>{item.not_agree_count}</strong></span>
                            <span>💬 Can't Comment: <strong>{item.cant_comment_count}</strong></span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="no-confessions">
                      No confessions for you. Apparently, no one cares about you.
                    </div>
                  )}
                </div>
              ) : (
                <div className="result-card" style={{ justifyContent: 'center', alignItems: 'center' }}>
                  <p style={{ color: 'var(--text-muted)' }}>Select a member on the left to read their confessions.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* VIEW: Endorse Pass Device view */}
      {view === 'pass-device-endorse' && endorseTargetName && (
        <section className="fade-in" style={{ textAlign: 'center', padding: '3rem 0' }}>
          <div className="status-pill">
            Endorsement Loop: Round {endorseVoterIdx + 1} of {endorseVoters.length}
          </div>
          
          <h2 style={{ fontSize: '2rem', margin: '1.25rem 0', color: 'var(--text-primary)' }}>
            Pass the device to:
          </h2>
          
          <div style={{
            fontSize: '3.2rem',
            fontWeight: 'bold',
            background: 'var(--gradient-text)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            margin: '1.5rem 0',
            textShadow: '0 6px 15px rgba(139, 92, 246, 0.25)'
          }}>
            {endorseVoters[endorseVoterIdx]?.name}
          </div>

          <p style={{ color: 'var(--text-secondary)', maxWidth: '500px', margin: '0 auto 3rem auto', fontSize: '1.05rem' }}>
            We are endorsing confessions written about **{endorseTargetName}**. 
            Please take the device in private, vote honestly on each confession, and submit.
          </p>

          <button 
            type="button" 
            onClick={() => setView('writing-endorse')} 
            className="btn btn-primary"
            style={{ width: '100%', maxWidth: '360px', fontSize: '1.1rem' }}
          >
            Start My Endorsements
          </button>
        </section>
      )}

      {/* VIEW: Endorse Writing View */}
      {view === 'writing-endorse' && endorseTargetName && (
        <section className="fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div className="status-pill">
              Endorsing as: {endorseVoters[endorseVoterIdx]?.name}
            </div>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Voter {endorseVoterIdx + 1} / {endorseVoters.length}
            </span>
          </div>

          <h2 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>
            Endorse Confessions for: <strong style={{ color: 'var(--accent-pink-light)' }}>{endorseTargetName}</strong>
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '2rem' }}>
            For each anonymous confession below, state whether you agree, disagree, or have no comment.
          </p>

          <div style={{ maxHeight: '420px', overflowY: 'auto', paddingRight: '0.5rem', marginBottom: '2rem' }}>
            {(resultsData[endorseTargetName] || []).map((item) => (
              <div key={item.id} className="confess-item" style={{ borderLeft: '3px solid var(--accent-purple)' }}>
                <div style={{ fontSize: '1.05rem', fontWeight: '500', marginBottom: '1rem', color: 'var(--text-primary)' }}>
                  "{item.confession_text}"
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className={`btn ${endorseVotes[item.id] === 'agree' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.5rem 1.25rem', borderRadius: '10px', fontSize: '0.9rem', flex: 1, minWidth: '110px' }}
                    onClick={() => setEndorseVotes({ ...endorseVotes, [item.id]: 'agree' })}
                  >
                    👍 Agree
                  </button>
                  <button
                    type="button"
                    className={`btn ${endorseVotes[item.id] === 'not_agree' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.5rem 1.25rem', borderRadius: '10px', fontSize: '0.9rem', flex: 1, minWidth: '110px' }}
                    onClick={() => setEndorseVotes({ ...endorseVotes, [item.id]: 'not_agree' })}
                  >
                    👎 Not Agree
                  </button>
                  <button
                    type="button"
                    className={`btn ${endorseVotes[item.id] === 'cant_comment' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ padding: '0.5rem 1.25rem', borderRadius: '10px', fontSize: '0.9rem', flex: 1, minWidth: '110px' }}
                    onClick={() => setEndorseVotes({ ...endorseVotes, [item.id]: 'cant_comment' })}
                  >
                    💬 Can't Comment
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button 
            type="button" 
            onClick={handleSubmitVoterEndorsements} 
            disabled={loading} 
            className="btn btn-primary"
            style={{ width: '100%' }}
          >
            {loading ? 'Submitting...' : 'Submit and Next'}
          </button>
        </section>
      )}

      {/* Rules Modal Overlay */}
      {showRulesModal && (
        <div className="modal-overlay fade-in" onClick={() => setShowRulesModal(false)}>
          <div className="modal-content fade-in" onClick={(e) => e.stopPropagation()}>
            {renderRules()}
            <div style={{ textAlign: 'right', marginTop: '2rem' }}>
              <button type="button" className="btn btn-primary" onClick={() => setShowRulesModal(false)}>
                Got It
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
