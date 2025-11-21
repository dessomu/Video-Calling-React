import { useState, useEffect } from "react";
import VideoRoom from "./components/VideoRoom";
// import "./App.css";
import { auth } from "./config/firebase";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

export default function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");

  const [roomId, setRoomId] = useState(
    () => localStorage.getItem("roomId") || ""
  );
  const [joined, setJoined] = useState(() => !!localStorage.getItem("roomId"));

  async function handleSignUp() {
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (error) {
      setError(error.message.substring(10, error.message.length));
    }
    setEmail("");
    setPassword("");

    if (email === "" || password === "") {
      setError("Please fill all the fields");
    }
  }

  async function handleSignIn() {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      setError(error.message.substring(10, error.message.length));
    }

    if (email === "" || password === "") {
      setError("Please fill all the fields");
    }
  }

  async function handleSignOut() {
    try {
      await signOut(auth);
    } catch (error) {
      console.log(error.message);
    }
    setUser(null);
    setEmail("");
    setPassword("");
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        console.log("User is signed in", firebaseUser);
        setUser(firebaseUser); // 🔥 persist in React state
      } else {
        console.log("User is signed out");
        setUser(null); // 🔥 clear user
      }
    });

    return () => unsubscribe();
  }, []);

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

  if (!user) {
    return (
      <div className="form">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="text"
          placeholder="Enter Your Email"
        />
        <label htmlFor="password">Password</label>

        <input
          id="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="text"
          placeholder="Enter Password"
        />
        <button onClick={handleSignUp} className="signUp">
          Sign Up
        </button>
        <button onClick={handleSignIn} className="signIn">
          Sign In
        </button>
        {error ? (
          <div className="error-modal">
            {error}
            <button
              onClick={() => setError("")}
              style={{ background: "green", width: "50px" }}
            >
              Ok!
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="join-room">
      {!joined ? (
        <div className="join-card">
          <h2 className="join-title">🎥 Join a Room</h2>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            placeholder="Enter Room ID"
            className="room-input"
          />
          <button className="join-btn" onClick={handleJoin}>
            Join
          </button>
          <button
            className="logout-btn"
            style={{
              background: "white",
              color: "black",
              position: "fixed",
              top: "-2rem",
              right: "2rem",
              padding: "10px",
              borderRadius: "10px",
              border: "solid 1px red",
            }}
            onClick={handleSignOut}
          >
            Logout
          </button>
        </div>
      ) : (
        <VideoRoom user={user} roomId={roomId} onLeave={handleLeave} />
      )}
    </div>
  );
}
