import { useEffect, useRef } from "react";
import io from "socket.io-client";

export default function VideoRoom({ roomId }) {
  const socketRef = useRef();
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const peerRef = useRef();
  const SERVER_URL = import.meta.env.VITE_SERVER_URL;

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
      console.warn("⚠️ Peer disconnected! Attempting reconnection...");
      try {
        peer.close(); // close old peer
      } catch (err) {
        console.warn("Peer already closed");
        console.log(err);
      }
      peerRef.current = null;

      setTimeout(() => reconnectPeer(), 1500); // short delay before re-init
    }

    async function reconnectPeer() {
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
      if (["disconnected", "failed", "closed"].includes(peer.connectionState)) {
        handlePeerDisconnect();
      }
    };

    socket.on("disconnect", () => {
      console.warn("⚠️ Socket disconnected!");
      handlePeerDisconnect();
    });

    // 1️⃣ attach ontrack immediately
    peer.ontrack = (event) => {
      const remoteStream = event.streams[0];
      console.log("📡 Remote stream ID:", remoteStream.id);
      remoteVideoRef.current.srcObject = remoteStream;
    };

    // 2️⃣ Attach onicecandidate + connection state
    peer.onicecandidate = (e) => {
      if (e.candidate)
        socket.emit("ice-candidate", { candidate: e.candidate, roomId });
    };

    // 3️⃣ connect socket, join room
    socket.on("connect", () => console.log("Connected as:", socket.id));
    socket.emit("join-room", roomId);

    // 4️⃣ Attach signaling listeners (offer/answer/ice)
    socket.on("user-joined", async (newUserId) => {
      if (socket.id !== newUserId) {
        console.log("📢 user-joined:", newUserId);
        // Wait until local stream ready
        await waitForLocalStream();
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
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
  }, [roomId, SERVER_URL]);

  return (
    <div>
      <h2>Room: {roomId}</h2>
      <div style={{ display: "flex", gap: "1rem", justifyContent: "center" }}>
        <video ref={localVideoRef} autoPlay muted playsInline width="300" />
        <video ref={remoteVideoRef} autoPlay playsInline width="400" />
      </div>
    </div>
  );
}
