import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import micOn from "../assets/mic-on.png";
import micOff from "../assets/mic-off.png";
import speakerOn from "../assets/volume-on.png";
import speakerOff from "../assets/volume-off.png";
import hungUp from "../assets/hang-up.png";
import "./VideoRoom.css";
const SERVER_URL = import.meta.env.VITE_SERVER_URL;

export default function VideoRoom({ roomId, onLeave }) {
  const socketRef = useRef();
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const peerRef = useRef();
  const [remoteUserLeft, setRemoteUserLeft] = useState(false); // 👈 new
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);

  useEffect(() => {
    const socket = io(SERVER_URL);
    const peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    socketRef.current = socket;
    peerRef.current = peer;

    let isUnmounted = false;

    // 🧱 1️⃣ Define reconnection helpers first
    async function handlePeerDisconnect() {
      await new Promise((r) => setTimeout(r, 800));
      if (remoteUserLeft) {
        console.log("Peer disconnected permanently — not reconnecting.");
        return;
      }
      console.warn("⚠️ Peer disconnected! Attempting reconnection...");
      try {
        if (peerRef.current === null) return;
        peer.close(); // close old peer
      } catch (err) {
        console.warn("Peer already closed", err);
      }
      peerRef.current = null;
      setTimeout(() => reconnectPeer(), 1500); // short delay before re-init
    }

    async function reconnectPeer() {
      if (remoteUserLeft) {
        console.log("Skipping reconnection — remote user left.");
        return;
      }
      if (peerRef.current && peerRef.current.connectionState !== "closed") {
        console.log("Peer already active — skipping reconnect.");
        return;
      }

      console.log("🔁 Reconnecting peer...");

      const newPeer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      peerRef.current = newPeer;

      // re-attach ICE and track handlers
      newPeer.onicecandidate = (e) => {
        if (e.candidate)
          socket.emit("ice-candidate", { candidate: e.candidate, roomId });
      };
      newPeer.ontrack = (e) => {
        console.log("📡 Remote stream re-received:", e.streams[0].id);
        remoteVideoRef.current.srcObject = e.streams[0];
      };

      const stream = localVideoRef.current?.srcObject;
      if (stream)
        stream.getTracks().forEach((t) => newPeer.addTrack(t, stream));

      const offer = await newPeer.createOffer();
      await newPeer.setLocalDescription(offer);
      socket.emit("offer", { offer, roomId });
    }

    // 🧱 2️⃣ Hook into connection-state and socket events
    peer.onconnectionstatechange = () => {
      console.log("🔌 Peer state:", peer.connectionState);
      console.log(remoteUserLeft);

      if (remoteUserLeft) return console.log("👋 Remote left; ignore.");
      if (["disconnected", "failed", "closed"].includes(peer.connectionState)) {
        handlePeerDisconnect();
      }
    };

    // 1️⃣ Remote video track handling
    peer.ontrack = (event) => {
      const remoteStream = event.streams[0];
      console.log("📡 Remote stream ID:", remoteStream.id);
      if (!remoteVideoRef.current) {
        console.warn(
          "⚠️ Remote video element not ready, skipping track assignment."
        );
        return;
      }
      remoteVideoRef.current.srcObject = remoteStream;
    };

    // 2️⃣ ICE candidates
    peer.onicecandidate = (e) => {
      if (e.candidate)
        socket.emit("ice-candidate", { candidate: e.candidate, roomId });
    };

    // 3️⃣ join room
    socket.on("connect", () => console.log("Connected as:", socket.id));
    socket.emit("join-room", roomId);

    // 4️⃣ signaling listeners (offer/answer/ice)
    socket.on("user-joined", async (newUserId) => {
      console.log("📢 user-joined:", newUserId);
      setRemoteUserLeft(false); // ✅ Always reset UI

      // If peer is closed, rebuild it and reconnect
      if (!peerRef.current || peerRef.current.connectionState === "closed") {
        console.log("⚙️ Peer is closed — reconnecting...");
        await reconnectPeer();
        return;
      }

      if (socket.id !== newUserId) {
        // Wait until local stream ready
        await waitForLocalStream();
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.emit("offer", { offer, roomId });
      }
    });

    // When this user joins, server tells them who’s already there
    socket.on("existing-users", async (users) => {
      console.log("👥 Existing users in room:", users);
      if (users.length > 0) {
        setRemoteUserLeft(false); // ✅ Reset in case you had stale UI
        // Create offer for the first user in the list (1-on-1 scenario)
        await waitForLocalStream();
        const offer = await peerRef.current.createOffer();
        await peerRef.current.setLocalDescription(offer);
        socket.emit("offer", { offer, roomId });
      }
    });

    socket.on("offer", async ({ offer, from }) => {
      if (from === socket.id) return;
      try {
        console.log("📨 Got offer, creating answer...");
        await waitForLocalStream(); // ensure tracks added first
        await peer.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.emit("answer", { answer, roomId });
      } catch (err) {
        console.error("❌ Error handling offer:", err);
      }
    });

    socket.on("answer", async ({ answer, from }) => {
      if (from === socket.id) return;
      console.log("📨 Got answer, setting remote desc...");
      await peer.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on("ice-candidate", ({ candidate, from }) => {
      if (from === socket.id) return;
      peer.addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on("user-left", (userId) => {
      console.warn(`👋 User ${userId} left the room.`);
      console.log(userId);

      setRemoteUserLeft(true); // 👈 this updates UI
      peer.close();
      peerRef.current = null;
    });

    // 5️⃣ Create a promise helper for waiting for local stream
    let localStreamPromiseResolve;
    const localStreamReady = new Promise(
      (res) => (localStreamPromiseResolve = res)
    );
    function waitForLocalStream() {
      return localStreamReady;
    }

    // 6️⃣ Get local stream and add tracks as soon as available
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        console.log("🎥 Local stream ID:", stream.id);
        if (isUnmounted) return;
        localVideoRef.current.srcObject = stream;
        if (peer.signalingState !== "closed") {
          stream.getTracks().forEach((t) => peer.addTrack(t, stream));
        } else {
          console.warn("Peer was closed before adding tracks, skipping");
        }

        localStreamPromiseResolve(); // resolve once tracks are added
      } catch (err) {
        console.error("🚫 getUserMedia failed:", err);
        localStreamPromiseResolve(); // resolve anyway so signaling isn’t stuck
      }
    })();

    // cleanup
    return () => {
      isUnmounted = true;
      socket.disconnect();
      peer.close();
    };
  }, [roomId, onLeave, remoteUserLeft]);

  // 🎛️ Mic toggle
  const handleToggleMic = () => {
    const stream = localVideoRef.current?.srcObject;
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
      console.log(audioTrack.enabled ? "🎙️ Mic unmuted" : "🔇 Mic muted");
    }
  };

  // 🎧 Speaker toggle
  const handleToggleSpeaker = () => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = !remoteVideoRef.current.muted;
      setIsSpeakerMuted(remoteVideoRef.current.muted);
      console.log(
        remoteVideoRef.current.muted ? "🔇 Speaker muted" : "🔊 Speaker unmuted"
      );
    }
  };

  //  Leave call

  function handleLeaveClick() {
    console.log("👋 Leaving call manually...");
    peerRef.current?.close();
    socketRef.current?.disconnect();
    onLeave?.();
  }

  return (
    <div className="video-room">
      <h2 className="room-title">Room: {roomId}</h2>

      <div className="video-container">
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          className="video-element own"
        />
        {remoteUserLeft ? (
          <div className="user-left">
            <h1>🚫</h1>
            <h3>The other user has left the call</h3>
          </div>
        ) : (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="video-element remote"
          />
        )}
      </div>

      <div className="controls">
        <button className="icon-btn" onClick={handleToggleMic}>
          <img
            src={isMuted ? micOff : micOn}
            width="28"
            height="28"
            alt="mic"
          />
        </button>

        <button className="icon-btn" onClick={handleToggleSpeaker}>
          <img
            src={isSpeakerMuted ? speakerOff : speakerOn}
            width="28"
            height="28"
            alt="speaker"
          />
        </button>

        <button className="icon-btn leave-btn" onClick={handleLeaveClick}>
          <img src={hungUp} width="36" height="36" alt="leave" />
        </button>
      </div>
    </div>
  );
}
