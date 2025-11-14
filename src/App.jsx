import { useState } from "react";
import VideoRoom from "./components/VideoRoom";

export default function App() {
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);

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
          <button onClick={() => setJoined(true)}>Join</button>
        </>
      ) : (
        <VideoRoom roomId={roomId} />
      )}
    </div>
  );
}
