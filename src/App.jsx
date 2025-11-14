import { useState } from "react";
import VideoRoom from "./components/VideoRoom";

export default function App() {
  const [roomId, setRoomId] = useState(
    () => localStorage.getItem("roomId") || ""
  );
  const [joined, setJoined] = useState(() => !!localStorage.getItem("roomId"));

  // 🧠 When user joins manually
  function handleJoin() {
    if (!roomId.trim()) return alert("Enter room ID first!");
    localStorage.setItem("roomId", roomId);
    setJoined(true);
  }

  // 🧠 When user leaves the call
  function handleLeave() {
    localStorage.removeItem("roomId");
    setJoined(false);
    setRoomId("");
  }

  return (
    <div style={{ textAlign: "center", padding: "2rem" }}>
      {!joined ? (
        <>
          <h2>🎥 Join a Room</h2>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Enter Room ID"
          />
          <button onClick={handleJoin}>Join</button>
        </>
      ) : (
        <VideoRoom roomId={roomId} onLeave={handleLeave} />
      )}
    </div>
  );
}
