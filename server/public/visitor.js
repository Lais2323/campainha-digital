// CLIENTE WEB DO VISITANTE / ENTREGADOR
// Suporte a seleção de vizinho/morador específico para tocar apenas no celular dele!

(function() {
  'use strict';

  let doorbellId = window.location.pathname.split('/campainha/')[1];
  if (!doorbellId) {
    const params = new URLSearchParams(window.location.search);
    doorbellId = params.get('id') || 'minha-casa';
  }
  doorbellId = doorbellId.replace(/\/$/, '') || 'minha-casa';

  // Elementos do DOM
  const doorbellTitleEl = document.getElementById('doorbellTitle');
  const houseAddressEl = document.getElementById('addressText');
  const stateSelectResident = document.getElementById('stateSelectResident');
  const stateCalling = document.getElementById('stateCalling');
  const stateInCall = document.getElementById('stateInCall');
  const stateEnded = document.getElementById('stateEnded');

  const residentsListEl = document.getElementById('residentsList');
  const callingPillText = document.getElementById('callingPillText');
  const callingTargetTitle = document.getElementById('callingTargetTitle');
  const callingNotice = document.getElementById('callingNotice');
  const connectedResidentAvatar = document.getElementById('connectedResidentAvatar');
  const inCallBadgeText = document.getElementById('inCallBadgeText');

  const btnCancelCall = document.getElementById('btnCancelCall');
  const btnRestart = document.getElementById('btnRestart');
  const btnToggleMic = document.getElementById('btnToggleMic');
  const labelMic = document.getElementById('labelMic');
  const btnToggleSpeaker = document.getElementById('btnToggleSpeaker');
  const labelSpeaker = document.getElementById('labelSpeaker');
  const btnToggleVideo = document.getElementById('btnToggleVideo');
  const labelVideo = document.getElementById('labelVideo');
  const btnEndCall = document.getElementById('btnEndCall');
  let isSpeakerOn = true;

  const remoteAudio = document.getElementById('remoteAudio');
  const remoteVideo = document.getElementById('remoteVideo');
  const localVideo = document.getElementById('localVideo');
  const remoteVideoContainer = document.getElementById('remoteVideoContainer');
  const localVideoContainer = document.getElementById('localVideoContainer');
  const voiceOnlyContainer = document.getElementById('voiceOnlyContainer');
  const callTimerEl = document.getElementById('callTimer');

  // Variáveis de Estado
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
  let selectedResident = null;
  let residentsList = [];
  let pendingIceCandidates = [];

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  function initSocket() {
    socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2500,
      timeout: 20000
    });

    socket.on('connect', () => {
      console.log('Conectado ao servidor de campainha!');
      socket.emit('register-visitor', { doorbellId });
    });

    socket.on('registered', ({ config, residents }) => {
      if (config) {
        if (config.title) doorbellTitleEl.textContent = config.title;
        if (config.address) houseAddressEl.textContent = config.address;
      }
      residentsList = residents || (config ? config.residents : []) || [];
      renderResidentsSelection();
    });

    socket.on('residents-updated', (updatedResidents) => {
      residentsList = updatedResidents || [];
      renderResidentsSelection();
    });

    socket.on('ringing-started', () => {
      switchState('calling');
      playRingbackTone();
    });

    socket.on('call-answered', async ({ by, resident }) => {
      console.log('Chamada atendida pelo morador!', by, resident);
      stopRingbackTone();
      connectedOwnerSocketId = by;

      if (resident && resident.name) {
        inCallBadgeText.textContent = `FALANDO COM: ${resident.name.toUpperCase()} (${resident.unit})`;
        if (resident.photo) {
          connectedResidentAvatar.innerHTML = `<img src="${resident.photo}" alt="${resident.name}">`;
        }
      }

      await startMediaAndWebRTC();
      switchState('incall');
      startTimer();
    });

    socket.on('call-rejected', () => {
      stopRingbackTone();
      cleanupMedia();
      switchState('ended');
    });

    socket.on('call-ended', () => {
      stopRingbackTone();
      cleanupMedia();
      switchState('ended');
    });

    socket.on('webrtc-offer', async ({ offer, from }) => {
      try {
        if (!peerConnection) await createPeerConnection();
        if (localStream) {
          localStream.getTracks().forEach(track => {
            const senders = peerConnection.getSenders();
            if (!senders.some(s => s.track === track)) {
              peerConnection.addTrack(track, localStream);
            }
          });
        }
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        flushPendingIceCandidates();
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
          flushPendingIceCandidates();
        }
      } catch (err) {
        console.error('Erro na resposta WebRTC:', err);
      }
    });

    socket.on('webrtc-ice-candidate', async ({ candidate }) => {
      try {
        if (!candidate) return;
        if (peerConnection && peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
          pendingIceCandidates.push(candidate);
        }
      } catch (err) {
        console.warn('Erro no candidato ICE:', err);
      }
    });

    function flushPendingIceCandidates() {
      if (!peerConnection || !peerConnection.remoteDescription) return;
      while (pendingIceCandidates.length > 0) {
        const c = pendingIceCandidates.shift();
        peerConnection.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
    }

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

  // RENDERIZA A LISTA DE MORADORES DISPONÍVEIS PARA LIGAÇÃO (COM AS FOTOS DO APP)
  function renderResidentsSelection() {
    residentsListEl.innerHTML = '';

    const list = (residentsList && residentsList.length > 0) ? residentsList : [
      {
        id: 'usr_admin_1',
        name: (doorbellTitleEl.textContent && doorbellTitleEl.textContent !== 'Campainha Residencial') ? doorbellTitleEl.textContent : 'Administradora',
        unit: 'Casa 1',
        photo: '',
        role: 'admin'
      }
    ];

    list.forEach(res => {
      const card = document.createElement('div');
      card.className = 'resident-card-btn';
      
      const avatarHtml = res.photo 
        ? `<img class="res-avatar" src="${res.photo}" alt="${res.name}">` 
        : `<div class="res-avatar res-avatar-initial">${(res.name || 'M').charAt(0).toUpperCase()}</div>`;

      card.innerHTML = `
        ${avatarHtml}
        <span class="res-unit-badge">${res.unit || 'Casa 1'}</span>
        <span class="res-name">${res.name || 'Morador'}</span>
        <div class="res-call-pill">
          <svg style="width:13px;height:13px;" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
          </svg>
          Ligar
        </div>
      `;

      card.addEventListener('click', () => {
        triggerCallToResident(res);
      });

      residentsListEl.appendChild(card);
    });
  }

  // Tocar para um vizinho / morador específico!
  function triggerCallToResident(res) {
    selectedResident = res;
    callingPillText.textContent = `TOCANDO: ${(res.unit || 'CASA').toUpperCase()}...`;
    callingTargetTitle.textContent = `${res.name} (${res.unit || 'Casa'})`;
    callingNotice.innerHTML = `Chamando <strong>${res.name}</strong> na <strong>${res.unit || 'Casa'}</strong>...`;

    switchState('calling');
    playRingbackTone();
    // Inicia permissão e captura de Câmera + Microfone por padrão!
    requestMediaEarly();

    socket.emit('ring-doorbell', {
      doorbellId,
      targetUnit: res.unit,
      targetResidentId: res.id,
      targetRole: res.role || (res.isAdmin ? 'admin' : 'user'),
      targetName: res.name,
      visitorInfo: {
        userAgent: navigator.userAgent,
        time: new Date().toLocaleTimeString('pt-BR')
      }
    });
  }

  function switchState(state) {
    stateSelectResident.classList.remove('active');
    stateCalling.classList.remove('active');
    stateInCall.classList.remove('active');
    stateEnded.classList.remove('active');

    if (state === 'select') stateSelectResident.classList.add('active');
    if (state === 'calling') stateCalling.classList.add('active');
    if (state === 'incall') stateInCall.classList.add('active');
    if (state === 'ended') stateEnded.classList.add('active');
  }

  // SOLICITA CÂMERA (VÍDEO) E MICROFONE POR PADRÃO AO TOCAR A CAMPAINHA
  async function requestMediaEarly() {
    if (localStream) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        }
      });
      localAudioTrack = localStream.getAudioTracks()[0];
      localVideoTrack = localStream.getVideoTracks()[0];

      if (localVideoTrack) {
        isVideoEnabled = true;
        localVideo.srcObject = new MediaStream([localVideoTrack]);
        localVideoContainer.classList.remove('hidden');
        btnToggleVideo.classList.add('video-on');
        labelVideo.textContent = 'Desativar Vídeo';
      }
    } catch (err) {
      console.warn('Vídeo negado ou indisponível no navegador, solicitando apenas áudio:', err);
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });
        localAudioTrack = localStream.getAudioTracks()[0];
        localVideoTrack = null;
        isVideoEnabled = false;
        localVideoContainer.classList.add('hidden');
        btnToggleVideo.classList.remove('video-on');
        labelVideo.textContent = 'Ativar Vídeo';
      } catch (e) {
        console.error('Microfone negado:', e);
      }
    }
  }

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

  async function startMediaAndWebRTC() {
    if (!localStream) {
      await requestMediaEarly();
    }
    await createPeerConnection();

    if (localStream) {
      localStream.getTracks().forEach(track => {
        const senders = peerConnection.getSenders();
        if (!senders.some(s => s.track === track)) {
          peerConnection.addTrack(track, localStream);
        }
      });
    }

    if (isVideoEnabled && localVideoTrack) {
      localVideo.srcObject = new MediaStream([localVideoTrack]);
      localVideoContainer.classList.remove('hidden');
      btnToggleVideo.classList.add('video-on');
      labelVideo.textContent = 'Desativar Vídeo';
    }

    if (peerConnection.signalingState === 'stable') {
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

    if (isVideoEnabled) {
      socket.emit('video-state-changed', {
        doorbellId,
        isVideoActive: true,
        to: connectedOwnerSocketId
      });
    }
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
        remoteAudio.play().catch(e => console.log('Audio play error:', e));
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

  // ATIVAR / DESATIVAR VÍDEO NO RODA-PÉ
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

        if (localStream) {
          localStream.addTrack(localVideoTrack);
        } else {
          localStream = videoStream;
        }

        if (peerConnection) {
          const senders = peerConnection.getSenders();
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');

          if (videoSender) {
            await videoSender.replaceTrack(localVideoTrack);
          } else {
            peerConnection.addTrack(localVideoTrack, localStream);
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('webrtc-offer', { doorbellId, offer, to: connectedOwnerSocketId });
          }
        }

        isVideoEnabled = true;
        btnToggleVideo.classList.add('video-on');
        labelVideo.textContent = 'Desativar Vídeo';
        socket.emit('video-state-changed', { doorbellId, isVideoActive: true, to: connectedOwnerSocketId });

      } catch (err) {
        alert('Não foi possível ativar a câmera.');
      }
    } else {
      if (localVideoTrack) {
        localVideoTrack.stop();
        if (peerConnection) {
          const senders = peerConnection.getSenders();
          const videoSender = senders.find(s => s.track && s.track.kind === 'video');
          if (videoSender) {
            peerConnection.removeTrack(videoSender);
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('webrtc-offer', { doorbellId, offer, to: connectedOwnerSocketId });
          }
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

  function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    if (remoteAudio) {
      remoteAudio.muted = !isSpeakerOn;
    }
    if (btnToggleSpeaker) {
      if (isSpeakerOn) {
        btnToggleSpeaker.classList.add('active');
        if (labelSpeaker) labelSpeaker.textContent = 'Viva-Voz';
      } else {
        btnToggleSpeaker.classList.remove('active');
        if (labelSpeaker) labelSpeaker.textContent = 'Mudo';
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
    pendingIceCandidates = [];
  }

  btnCancelCall.addEventListener('click', () => {
    stopRingbackTone();
    socket.emit('reject-call', { doorbellId });
    switchState('select');
  });

  btnToggleMic.addEventListener('click', toggleMic);
  if (btnToggleSpeaker) btnToggleSpeaker.addEventListener('click', toggleSpeaker);
  btnToggleVideo.addEventListener('click', toggleVideo);

  btnEndCall.addEventListener('click', () => {
    socket.emit('end-call', { doorbellId });
    cleanupMedia();
    switchState('ended');
  });

  btnRestart.addEventListener('click', () => {
    switchState('select');
  });

  initSocket();

})();
