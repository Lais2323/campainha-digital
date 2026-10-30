// CLIENTE WEB DO VISITANTE / ENTREGADOR
// Dispara a chamada AUTOMATICAMENTE ao escanear o QR Code
// Sem necessidade de login!

(function() {
  'use strict';

  // Extrai o ID da campainha da URL: /campainha/:id ou ?id=:id
  let doorbellId = window.location.pathname.split('/campainha/')[1];
  if (!doorbellId) {
    const params = new URLSearchParams(window.location.search);
    doorbellId = params.get('id') || 'minha-casa';
  }
  doorbellId = doorbellId.replace(/\/$/, '') || 'minha-casa';

  // Elementos do DOM
  const ownerNameEl = document.getElementById('ownerName');
  const houseAddressEl = document.getElementById('addressText');
  const stateCalling = document.getElementById('stateCalling');
  const stateInCall = document.getElementById('stateInCall');
  const stateEnded = document.getElementById('stateEnded');
  const endedTitleEl = document.getElementById('endedTitle');
  const endedDescEl = document.getElementById('endedDesc');
  const btnAutoStartVoice = document.getElementById('btnAutoStartVoice');
  const btnCancelCall = document.getElementById('btnCancelCall');
  const btnRestart = document.getElementById('btnRestart');

  const btnToggleMic = document.getElementById('btnToggleMic');
  const labelMic = document.getElementById('labelMic');
  const btnToggleVideo = document.getElementById('btnToggleVideo');
  const labelVideo = document.getElementById('labelVideo');
  const btnEndCall = document.getElementById('btnEndCall');

  const remoteAudio = document.getElementById('remoteAudio');
  const remoteVideo = document.getElementById('remoteVideo');
  const localVideo = document.getElementById('localVideo');
  const remoteVideoContainer = document.getElementById('remoteVideoContainer');
  const localVideoContainer = document.getElementById('localVideoContainer');
  const voiceOnlyContainer = document.getElementById('voiceOnlyContainer');
  const callTimerEl = document.getElementById('callTimer');

  // Variáveis de Estado WebRTC
  let socket = null;
  let peerConnection = null;
  let localStream = null;
  let localAudioTrack = null;
  let localVideoTrack = null;
  let isVideoEnabled = false;
  let isMicMuted = false;
  let callTimerInterval = null;
  let callSeconds = 0;
  let audioContext = null;
  let ringToneInterval = null;
  let connectedOwnerSocketId = null;
  let autoRingTriggered = false;

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // 1. Conexão Socket.io
  function initSocket() {
    socket = io();

    socket.on('connect', () => {
      console.log('Conectado ao servidor de campainha!');
      socket.emit('register-visitor', { doorbellId });

      // ACIONAMENTO AUTOMÁTICO DA CHAMADA ASSIM QUE CARREGA A PÁGINA
      if (!autoRingTriggered) {
        autoRingTriggered = true;
        autoTriggerCall();
      }
    });

    socket.on('registered', ({ config }) => {
      if (config) {
        updateDoorbellInfo(config);
      }
    });

    socket.on('config-updated', (config) => {
      updateDoorbellInfo(config);
    });

    socket.on('ringing-started', () => {
      switchState('calling');
      playRingbackTone();
    });

    // Quando o morador atende
    socket.on('call-answered', async ({ by, ownerUser }) => {
      console.log('Chamada atendida pelo morador!', by);
      stopRingbackTone();
      connectedOwnerSocketId = by;

      if (ownerUser && ownerUser.name) {
        ownerNameEl.textContent = ownerUser.name;
      }

      await startMediaAndWebRTC();
      switchState('incall');
      startTimer();
    });

    socket.on('call-rejected', () => {
      stopRingbackTone();
      cleanupMedia();
      endedTitleEl.textContent = 'Chamada Não Atendida';
      endedDescEl.textContent = 'O morador não pôde atender no momento.';
      switchState('ended');
    });

    socket.on('call-ended', () => {
      stopRingbackTone();
      cleanupMedia();
      endedTitleEl.textContent = 'Chamada Finalizada';
      endedDescEl.textContent = 'A conversa com o morador foi encerrada.';
      switchState('ended');
    });

    // Sinalização WebRTC
    socket.on('webrtc-offer', async ({ offer, from }) => {
      try {
        if (!peerConnection) await createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('webrtc-answer', { doorbellId, answer, to: from });
      } catch (err) {
        console.error('Erro na oferta WebRTC:', err);
      }
    });

    socket.on('webrtc-answer', async ({ answer }) => {
      try {
        if (peerConnection) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
      } catch (err) {
        console.error('Erro na resposta WebRTC:', err);
      }
    });

    socket.on('webrtc-ice-candidate', async ({ candidate }) => {
      try {
        if (peerConnection && candidate) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (err) {
        console.error('Erro no candidato ICE:', err);
      }
    });

    socket.on('remote-video-state-changed', ({ isVideoActive }) => {
      if (isVideoActive) {
        remoteVideoContainer.classList.remove('hidden');
        voiceOnlyContainer.style.opacity = '0.15';
      } else {
        remoteVideoContainer.classList.add('hidden');
        voiceOnlyContainer.style.opacity = '1';
      }
    });
  }

  function updateDoorbellInfo(config) {
    if (config.ownerName) ownerNameEl.textContent = config.ownerName;
    if (config.address) houseAddressEl.textContent = config.address;
  }

  function switchState(state) {
    stateCalling.classList.remove('active');
    stateInCall.classList.remove('active');
    stateEnded.classList.remove('active');

    if (state === 'calling') stateCalling.classList.add('active');
    if (state === 'incall') stateInCall.classList.add('active');
    if (state === 'ended') stateEnded.classList.add('active');
  }

  // DISPARAR CHAMADA AUTOMATICAMENTE AO ABRIR O LINK
  function autoTriggerCall() {
    console.log('[🔔 DISPARO AUTOMÁTICO] Tocando a campainha...');
    switchState('calling');
    playRingbackTone();

    // Solicita o microfone antecipadamente para já estar pronto quando o morador atender
    requestMicrophoneEarly();

    socket.emit('ring-doorbell', {
      doorbellId,
      visitorInfo: {
        userAgent: navigator.userAgent,
        time: new Date().toLocaleTimeString('pt-BR')
      }
    });
  }

  async function requestMicrophoneEarly() {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false // Câmera SEMPRE desligada por padrão
      });
      localAudioTrack = localStream.getAudioTracks()[0];
      btnAutoStartVoice.classList.add('hidden');
    } catch (err) {
      console.log('Permissão de microfone requer toque do usuário:', err);
      btnAutoStartVoice.classList.remove('hidden');
    }
  }

  // Som de chamada tocando (Ringback)
  function playRingbackTone() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!audioContext) audioContext = new AudioCtx();
      if (audioContext.state === 'suspended') audioContext.resume();

      const playBeep = () => {
        if (!stateCalling.classList.contains('active')) return;
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, audioContext.currentTime);
        gain.gain.setValueAtTime(0.08, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 1.2);
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.start();
        osc.stop(audioContext.currentTime + 1.2);
      };

      playBeep();
      if (ringToneInterval) clearInterval(ringToneInterval);
      ringToneInterval = setInterval(playBeep, 3000);
    } catch(e) {}
  }

  function stopRingbackTone() {
    if (ringToneInterval) {
      clearInterval(ringToneInterval);
      ringToneInterval = null;
    }
  }

  // Estabelecer conexão WebRTC de Áudio (SOMENTE VOZ POR PADRÃO)
  async function startMediaAndWebRTC() {
    if (!localStream) {
      await requestMicrophoneEarly();
    }

    await createPeerConnection();

    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await peerConnection.setLocalDescription(offer);

    socket.emit('webrtc-offer', {
      doorbellId,
      offer,
      to: connectedOwnerSocketId
    });
  }

  async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          doorbellId,
          candidate: event.candidate,
          to: connectedOwnerSocketId
        });
      }
    };

    peerConnection.ontrack = (event) => {
      if (event.track.kind === 'audio') {
        remoteAudio.srcObject = event.streams[0];
        remoteAudio.play().catch(e => console.log('Erro ao tocar áudio:', e));
      } else if (event.track.kind === 'video') {
        remoteVideo.srcObject = event.streams[0];
        remoteVideoContainer.classList.remove('hidden');
        voiceOnlyContainer.style.opacity = '0.15';
      }
    };

    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
        cleanupMedia();
        switchState('ended');
      }
    };
  }

  // REQUISITO: BOTÃO NO RODA-PÉ PRA ATIVAR VÍDEO SE NECESSÁRIO
  async function toggleVideo() {
    if (!isVideoEnabled) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        });

        localVideoTrack = videoStream.getVideoTracks()[0];
        localVideo.srcObject = new MediaStream([localVideoTrack]);
        localVideoContainer.classList.remove('hidden');

        const senders = peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');

        if (videoSender) {
          videoSender.replaceTrack(localVideoTrack);
        } else {
          peerConnection.addTrack(localVideoTrack, localStream);
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          socket.emit('webrtc-offer', { doorbellId, offer, to: connectedOwnerSocketId });
        }

        isVideoEnabled = true;
        btnToggleVideo.classList.add('video-on');
        labelVideo.textContent = 'Desativar Vídeo';
        socket.emit('video-state-changed', { doorbellId, isVideoActive: true, to: connectedOwnerSocketId });

      } catch (err) {
        console.error('Erro ao ativar câmera:', err);
        alert('Não foi possível ativar a câmera.');
      }
    } else {
      if (localVideoTrack) {
        localVideoTrack.stop();
        const senders = peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) {
          peerConnection.removeTrack(videoSender);
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          socket.emit('webrtc-offer', { doorbellId, offer, to: connectedOwnerSocketId });
        }
        localVideoTrack = null;
      }
      localVideo.srcObject = null;
      localVideoContainer.classList.add('hidden');

      isVideoEnabled = false;
      btnToggleVideo.classList.remove('video-on');
      labelVideo.textContent = 'Ativar Vídeo';
      socket.emit('video-state-changed', { doorbellId, isVideoActive: false, to: connectedOwnerSocketId });
    }
  }

  function toggleMic() {
    if (localAudioTrack) {
      isMicMuted = !isMicMuted;
      localAudioTrack.enabled = !isMicMuted;
      if (isMicMuted) {
        btnToggleMic.classList.add('muted');
        labelMic.textContent = 'Voz Mudo';
      } else {
        btnToggleMic.classList.remove('muted');
        labelMic.textContent = 'Voz Ativa';
      }
    }
  }

  function startTimer() {
    callSeconds = 0;
    callTimerEl.textContent = '00:00';
    if (callTimerInterval) clearInterval(callTimerInterval);
    callTimerInterval = setInterval(() => {
      callSeconds++;
      const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
      const s = String(callSeconds % 60).padStart(2, '0');
      callTimerEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopTimer() {
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
  }

  function cleanupMedia() {
    stopTimer();
    stopRingbackTone();

    if (localAudioTrack) {
      localAudioTrack.stop();
      localAudioTrack = null;
    }
    if (localVideoTrack) {
      localVideoTrack.stop();
      localVideoTrack = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
      localStream = null;
    }
    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }

    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    remoteAudio.srcObject = null;
    localVideoContainer.classList.add('hidden');
    remoteVideoContainer.classList.add('hidden');
    voiceOnlyContainer.style.opacity = '1';

    isVideoEnabled = false;
    btnToggleVideo.classList.remove('video-on');
    labelVideo.textContent = 'Ativar Vídeo';
  }

  // Listeners
  btnAutoStartVoice.addEventListener('click', requestMicrophoneEarly);

  btnCancelCall.addEventListener('click', () => {
    stopRingbackTone();
    socket.emit('reject-call', { doorbellId });
    endedTitleEl.textContent = 'Chamada Cancelada';
    endedDescEl.textContent = 'Você cancelou a chamada.';
    switchState('ended');
  });

  btnToggleMic.addEventListener('click', toggleMic);
  btnToggleVideo.addEventListener('click', toggleVideo);

  btnEndCall.addEventListener('click', () => {
    socket.emit('end-call', { doorbellId });
    cleanupMedia();
    switchState('ended');
  });

  btnRestart.addEventListener('click', () => {
    autoTriggerCall();
  });

  // Iniciar conexão socket
  initSocket();

})();
