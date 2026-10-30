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
    socket = io();

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

  // RENDERIZA A LISTA DE VIZINHOS / MORADORES
  function renderResidentsSelection() {
    residentsListEl.innerHTML = '';

    if (!residentsList || residentsList.length === 0) {
      residentsListEl.innerHTML = `
        <div style="text-align:center; padding: 24px 12px; width: 100%;">
          <p style="color:#94a3b8; margin-bottom:16px; font-size: 0.95rem;">Toque abaixo para tocar a campainha da casa:</p>
          <button type="button" id="btnRingGeneral" class="btn-primary" style="padding:16px 28px; font-size:1.15rem; font-weight:700; border-radius:50px; width:100%; max-width: 300px; margin: 0 auto; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;">
            <svg style="width:22px;height:22px;" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
            </svg>
            Tocar Campainha
          </button>
        </div>
      `;
      const btn = document.getElementById('btnRingGeneral');
      if (btn) {
        btn.onclick = () => {
          triggerCallToResident({ id: 'geral', name: 'Residência', unit: 'Casa 1' });
        };
      }
      return;
    }

    if (residentsList.length === 1) {
      const res = residentsList[0];
      residentsListEl.innerHTML = `
        <div style="text-align:center; padding: 20px 12px; width: 100%;">
          <div style="margin-bottom: 18px;">
            <div style="width: 76px; height: 76px; border-radius: 50%; background: linear-gradient(135deg, #3b82f6, #1d4ed8); display: flex; align-items: center; justify-content: center; margin: 0 auto 10px; font-size: 1.8rem; color: #fff; box-shadow: 0 8px 20px rgba(59, 130, 246, 0.35);">
              ${res.photo ? `<img src="${res.photo}" alt="${res.name}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : (res.name ? res.name.charAt(0).toUpperCase() : '🏠')}
            </div>
            <h3 style="color:#f8fafc; font-size: 1.2rem; font-weight:700; margin: 0 0 4px 0;">${res.name}</h3>
            <span style="display:inline-block; background:rgba(59, 130, 246, 0.15); color:#60a5fa; border:1px solid rgba(59, 130, 246, 0.3); border-radius:20px; padding:2px 12px; font-size:0.8rem; font-weight:600;">${res.unit}</span>
          </div>

          <button type="button" id="btnRingSingle" class="btn-primary" style="padding:16px 28px; font-size:1.15rem; font-weight:700; border-radius:50px; width:100%; max-width: 300px; margin: 0 auto; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;">
            <svg style="width:22px;height:22px;" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
            </svg>
            Tocar Campainha
          </button>
        </div>
      `;
      const btn = document.getElementById('btnRingSingle');
      if (btn) {
        btn.onclick = () => {
          triggerCallToResident(res);
        };
      }
      return;
    }

    residentsListEl.innerHTML = '';
    residentsList.forEach(res => {
      const card = document.createElement('div');
      card.className = 'resident-card-btn';
      
      const avatarHtml = res.photo 
        ? `<img class="res-avatar" src="${res.photo}" alt="${res.name}">` 
        : `<div class="res-avatar">${res.name.charAt(0).toUpperCase()}</div>`;

      card.innerHTML = `
        ${avatarHtml}
        <span class="res-unit-badge">${res.unit}</span>
        <span class="res-name">${res.name}</span>
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
    callingPillText.textContent = `TOCANDO: ${res.unit.toUpperCase()}...`;
    callingTargetTitle.textContent = `${res.name} (${res.unit})`;
    callingNotice.innerHTML = `Chamando <strong>${res.name}</strong> na <strong>${res.unit}</strong>. Apenas o celular deste morador está tocando!`;

    switchState('calling');
    playRingbackTone();
    // Inicia permissão e captura de Câmera + Microfone por padrão!
    requestMediaEarly();

    socket.emit('ring-doorbell', {
      doorbellId,
      targetUnit: res.unit,
      targetResidentId: res.id,
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
  btnToggleVideo.addEventListener('click', toggleVideo);

  btnEndCall.addEventListener('click', () => {
    socket.emit('end-call', { doorbellId });
    cleanupMedia();
    switchState('ended');
  });

  btnRestart.addEventListener('click', () => {
    if (residentsList.length > 1) {
      switchState('select');
    } else if (residentsList.length === 1) {
      triggerCallToResident(residentsList[0]);
    }
  });

  initSocket();

})();
