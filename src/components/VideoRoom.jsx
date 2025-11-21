import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import micOn from "../assets/mic-on.png";
import micOff from "../assets/mic-off.png";
import speakerOn from "../assets/volume-on.png";
import speakerOff from "../assets/volume-off.png";
import hungUp from "../assets/hang-up.png";
import "./VideoRoom.css";
const SERVER_URL = import.meta.env.VITE_SERVER_URL;

export default function VideoRoom({ user, roomId, onLeave }) {
  const socketRef = useRef();
  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const peerRef = useRef();
  const iceBufferRef = useRef([]);
  const [remoteUserLeft, setRemoteUserLeft] = useState(false); // 👈 new
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);

  const [isOwner, setIsOwner] = useState(false);
  const [pendingRequests, setPendingRequests] = useState([]); // join approvals
  const [isAuthorized, setIsAuthorized] = useState(false);
  // const [remoteStreamActive, setRemoteStreamActive] = useState(false);

  function makePeer() {
    const socket = socketRef.current;
    const newPeer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    newPeer.onicecandidate = (e) => {
      if (e.candidate) {
        socket?.emit("ice-candidate", {
          candidate: e.candidate,
          roomId: localStorage.getItem("roomId"),
        });
      }
    };

    newPeer.ontrack = (e) => {
      const stream = e.streams[0];
      console.log("📡 Remote stream ID:", stream?.id);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
        setRemoteUserLeft(false);
      }
    };

    newPeer.onconnectionstatechange = () => {
      console.log("🔌 Peer state:", newPeer.connectionState);
      if (
        ["disconnected", "failed", "closed"].includes(newPeer.connectionState)
      ) {
        handlePeerDisconnect();
      }
    };

    // helper method stays attached to the peer itself
    newPeer.applyBufferedIce = async () => {
      if (!iceBufferRef.current.length) return;
      for (const c of iceBufferRef.current.splice(0)) {
        try {
          await newPeer.addIceCandidate(new RTCIceCandidate(c));
        } catch (err) {
          console.warn("Buffered addIceCandidate failed:", err);
        }
      }
    };

    return newPeer;
  }

  function closeCurrentPeer() {
    try {
      const p = peerRef.current;
      if (p) p.close();
    } catch (err) {
      console.log("closeCurrentPeer error:", err);
    } finally {
      peerRef.current = null;
    }
  }

  async function handlePeerDisconnect() {
    await new Promise((r) => setTimeout(r, 800));
    if (remoteUserLeft) {
      console.log("Peer disconnected permanently — not reconnecting.");
      return;
    }
    console.warn("⚠️ Peer disconnected! Attempting reconnection...");
    closeCurrentPeer();
    setTimeout(() => reconnectPeer(), 1500);
  }

  async function reconnectPeer() {
    console.log("🔁 Reconnecting peer...");

    const socket = socketRef.current;
    const roomId = localStorage.getItem("roomId");

    const newPeer = makePeer();
    peerRef.current = newPeer;

    const localStream = localVideoRef.current?.srcObject;
    if (localStream) {
      localStream.getTracks().forEach((t) => {
        try {
          newPeer.addTrack(t, localStream);
        } catch (e) {
          console.warn("addTrack during reconnect failed:", e);
        }
      });
    } else {
      console.log("No local stream yet while reconnecting.");
    }

    try {
      await newPeer.applyBufferedIce?.();
    } catch (e) {
      console.warn("Applying buffered ICE failed:", e);
    }

    try {
      if (["stable", ""].includes(newPeer.signalingState)) {
        const offer = await newPeer.createOffer();
        await newPeer.setLocalDescription(offer);
        socket?.emit("offer", { offer, roomId });
      } else {
        console.warn(
          "New peer not stable for creating offer:",
          newPeer.signalingState
        );
      }
    } catch (err) {
      console.warn("Failed to create offer during reconnect:", err);
    }
  }

  useEffect(() => {
    // authorization effect after loggin in to join room securely
    if (!user) return;

    async function connectSocket() {
      const token = await user.getIdToken();

      const socket = io(SERVER_URL, { auth: { token } });
      socketRef.current = socket;

      socket.emit("join-room", { roomId });

      socket.on("join-success", ({ role }) => {
        setIsOwner(role === "owner");
        setIsAuthorized(true); // 🔥 WebRTC can start now
        setRemoteUserLeft(false);
      });

      socket.on("join-pending", () => console.log("waiting for approval"));

      socket.on("join-request", ({ user, socketId }) => {
        setPendingRequests((prev) => [...prev, { user, socketId }]);
      });

      socket.on("join-approved", () => {
        setRemoteUserLeft(false);
        socket.emit("join-room", { roomId }); // retry join
      });

      socket.on("join-denied", () => {
        alert("Join denied");
        onLeave();
      });
    }

    connectSocket();
  }, [user, roomId, onLeave]);

  useEffect(() => {
    if (!isAuthorized) return;
    const socket = socketRef.current;
    let isUnmounted = false;

    peerRef.current = makePeer();
    peerRef.current.onnegotiationneeded = async () => {
      const socket = socketRef.current;
      const roomId = localStorage.getItem("roomId");
      const currentPeer = peerRef.current;
      if (!socket || !currentPeer) return;

      console.log("⚙️ Negotiation needed — sending offer");
      try {
        const offer = await currentPeer.createOffer();
        await currentPeer.setLocalDescription(offer);
        socket.emit("offer", { offer, roomId });
      } catch (err) {
        console.error("onnegotiationneeded error:", err);
      }
    };

    // create helper promise for local stream
    let localStreamPromiseResolve;
    const localStreamReady = new Promise(
      (res) => (localStreamPromiseResolve = res)
    );
    function waitForLocalStream() {
      return localStreamReady;
    }

    // -------------- socket handlers -----------------
    socket.on("user-joined", async (newUserId) => {
      console.log("📢 user-joined:", newUserId);
      setRemoteUserLeft(false);

      await waitForLocalStream();

      if (
        !peerRef.current ||
        ["disconnected", "failed", "closed"].includes(
          peerRef.current.connectionState
        )
      ) {
        console.log(
          "⚙️ Peer missing or closed — rebuilding via reconnectPeer..."
        );
        await reconnectPeer();
        return;
      }

      if (socket.id !== newUserId) {
        const currentPeer = peerRef.current;
        if (!currentPeer) return;
        if (currentPeer.signalingState !== "stable") {
          console.warn(
            "Peer not stable — forcing renegotiation via restartIce()"
          );
          try {
            await currentPeer.restartIce();
          } catch (e) {
            console.warn("restartIce failed:", e);
          }
        }

        try {
          const offer = await currentPeer.createOffer();
          await currentPeer.setLocalDescription(offer);
          socket.emit("offer", { offer, roomId });
        } catch (err) {
          console.error("Failed to create/send offer on user-joined:", err);
        }
      }
    });

    socket.on("existing-users", async (users) => {
      console.log("👥 Existing users in room:", users);
      if (!users || users.length === 0) return;
      setRemoteUserLeft(false);
      await waitForLocalStream();

      // ensure valid peer
      if (
        !peerRef.current ||
        ["disconnected", "failed", "closed"].includes(
          peerRef.current.connectionState
        )
      ) {
        console.log(
          "No valid peer when existing-users arrived — reconnecting..."
        );
        await reconnectPeer();
        return;
      }

      const currentPeer = peerRef.current;
      if (currentPeer.signalingState !== "stable") {
        console.warn(
          "Peer not stable — forcing renegotiation via restartIce()"
        );
        try {
          await currentPeer.restartIce();
        } catch (e) {
          console.warn("restartIce failed:", e);
        }
      }

      try {
        const offer = await currentPeer.createOffer();
        await currentPeer.setLocalDescription(offer);
        socket.emit("offer", { offer, roomId });
      } catch (err) {
        console.error("Failed to create offer for existing-users:", err);
      }
    });

    socket.on("offer", async ({ offer, from }) => {
      if (from === socket.id) return;
      console.log("📨 Got offer, creating answer...");

      await waitForLocalStream();

      // ensure a usable peer exists (recreate if closed)
      if (!peerRef.current || peerRef.current.signalingState === "closed") {
        console.log("Offer received but peer closed — creating fresh peer...");
        closeCurrentPeer();
        peerRef.current = makePeer();
      }

      const currentPeer = peerRef.current;
      try {
        await currentPeer.setRemoteDescription(
          new RTCSessionDescription(offer)
        );
        // apply buffered ICE if any (buffer stored above)
        if (currentPeer.applyBufferedIce) await currentPeer.applyBufferedIce();

        const answer = await currentPeer.createAnswer();
        await currentPeer.setLocalDescription(answer);
        socket.emit("answer", { answer, roomId });
      } catch (err) {
        console.error("❌ Error handling offer:", err);
      }
    });

    socket.on("answer", async ({ answer, from }) => {
      if (from === socket.id) return;
      // Use the *current* peerRef
      const currentPeer = peerRef.current;
      if (!currentPeer) {
        console.warn("Received answer but no peer exists; ignoring.");
        return;
      }
      if (currentPeer.signalingState === "closed") {
        console.warn("Received answer for closed peer — ignoring.");
        return;
      }
      try {
        await currentPeer.setRemoteDescription(
          new RTCSessionDescription(answer)
        );
        if (currentPeer.applyBufferedIce) await currentPeer.applyBufferedIce();
      } catch (err) {
        console.error("Error setting remote description from answer:", err);
      }
    });

    socket.on("ice-candidate", async ({ candidate, from }) => {
      if (from === socket.id) return;
      const currentPeer = peerRef.current;
      const iceBuffer = iceBufferRef.current;

      // If no peer or peer closed, buffer
      if (!currentPeer || currentPeer.signalingState === "closed") {
        console.warn("Buffering ICE candidate — no active peer yet.");
        iceBuffer.push(candidate);
        return;
      }

      // If remoteDescription is not set yet, buffer until it is
      if (!currentPeer.remoteDescription) {
        console.warn(
          "Buffering ICE candidate — remoteDescription not set yet."
        );
        iceBuffer.push(candidate);
        return;
      }

      // Safe to add candidate
      try {
        await currentPeer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("addIceCandidate failed:", err);
      }
    });

    // ---------- local media ----------
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        console.log("🎥 Local stream ID:", stream.id);
        if (isUnmounted) return;
        localVideoRef.current.srcObject = stream;

        if (peerRef.current && peerRef.current.signalingState !== "closed") {
          try {
            stream
              .getTracks()
              .forEach((t) => peerRef.current.addTrack(t, stream));
          } catch (e) {
            console.warn("addTrack failed on initial stream attach:", e);
          }
        }
        localStreamPromiseResolve();
      } catch (err) {
        console.error("🚫 getUserMedia failed:", err);
        localStreamPromiseResolve();
      }
    })();

    return () => {
      isUnmounted = true;
      localVideoRef.current?.srcObject?.getTracks()?.forEach((t) => t.stop());
      [
        "user-joined",
        "existing-users",
        "offer",
        "answer",
        "ice-candidate",
      ].forEach((evt) => socket.off(evt));
      closeCurrentPeer();
    };
  }, [roomId, onLeave, remoteUserLeft, isAuthorized, makePeer, reconnectPeer]);

  // "user left" UI listener
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleUserRejoined = async () => {
      console.log(
        "🔄 user-rejoined received — rebuilding connection gracefully"
      );

      setRemoteUserLeft(false);

      // Close current peer safely
      closeCurrentPeer();

      // Recreate peer and rejoin room cleanly
      peerRef.current = makePeer();
      socket.emit("join-room", { roomId });

      // Wait a short time before renegotiating
      setTimeout(() => {
        reconnectPeer();
      }, 800);
    };

    const handleRemoteLeft = ({ socketId }) => {
      console.log("👋 remote-user-left:", socketId);
      setRemoteUserLeft(true);
    };

    const handleUserJoined = async (newUserId) => {
      console.log("📢 user-joined:", newUserId);
      setRemoteUserLeft(false);

      // Only rebuild if peer is missing or dead
      if (
        !peerRef.current ||
        ["failed", "closed", "disconnected"].includes(
          peerRef.current.connectionState
        )
      ) {
        console.log("⚙️ Rebuilding peer (user-joined)...");
        await reconnectPeer();
      }
    };

    const handleExistingUsers = async (users) => {
      console.log("👥 existing-users:", users);

      // No remote users? nothing to do.
      if (!users || users.length === 0) return;

      setRemoteUserLeft(false);

      if (
        !peerRef.current ||
        ["failed", "closed", "disconnected"].includes(
          peerRef.current.connectionState
        )
      ) {
        console.log("⚙️ Rebuilding peer (existing-users)...");
        await reconnectPeer();
      }
    };

    socket.on("user-rejoined", handleUserRejoined);
    socket.on("remote-user-left", handleRemoteLeft);
    socket.on("user-joined", handleUserJoined);
    socket.on("existing-users", handleExistingUsers);

    return () => {
      socket.off("user-rejoined", handleUserRejoined);
      socket.off("remote-user-left", handleRemoteLeft);
      socket.off("user-joined", handleUserJoined);
      socket.off("existing-users", handleExistingUsers);
    };
  }, []);

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

    const socket = socketRef.current;
    const peer = peerRef.current;
    const roomId = localStorage.getItem("roomId");

    // 1️⃣ Tell server you're leaving
    if (socket && roomId) {
      socket.emit("leave-room", { roomId });
    }

    // 2️⃣ Stop local camera + mic
    const stream = localVideoRef.current?.srcObject;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }

    // 3️⃣ Close peer connection
    try {
      peer?.close();
    } catch (e) {
      console.warn("Peer close error", e);
    }

    // 4️⃣ Disconnect socket safely
    setTimeout(() => {
      socket?.disconnect();
      onLeave?.();
    }, 200);
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
            // onLoadedMetadata={() => setRemoteStreamActive(true)}
            // onEmptied={() => setRemoteStreamActive(false)}
            autoPlay
            playsInline
            className="video-element remote"
          />
        )}
      </div>
      {isOwner && pendingRequests.length > 0 && (
        <div className="join-requests">
          <h3>🔐 Join Requests</h3>
          {pendingRequests.map((req) => (
            <div key={req.socketId} className="request">
              <span>{req.user.email} wants to join</span>

              <button
                onClick={() => {
                  socketRef.current.emit("approve-join", {
                    roomId,
                    requesterSocketId: req.socketId,
                    allowUserId: req.user.uid,
                  });
                  setPendingRequests((prev) =>
                    prev.filter((r) => r.socketId !== req.socketId)
                  );
                }}
              >
                Approve
              </button>

              <button
                onClick={() => {
                  socketRef.current.emit("deny-join", {
                    requesterSocketId: req.socketId,
                  });
                  setPendingRequests((prev) =>
                    prev.filter((r) => r.socketId !== req.socketId)
                  );
                }}
              >
                Deny
              </button>
            </div>
          ))}
        </div>
      )}

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
