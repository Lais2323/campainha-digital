// CLIENTE WEB DO VISITANTE / ENTREGADOR
// Controles de mídia no rodapé (Microfone, Viva-Voz, Câmera, Encerrar)
// Padrão do Entregador: Microfone LIGADO, Viva-Voz LIGADO e Vídeo/Câmera LIGADO por padrão!

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
  const stateCall = document.getElementById('stateCall');
  const callingSection = document.getElementById('callingSection');
  const inCallSection = document.getElementById('inCallSection');
  const stateEnded = document.getElementById('stateEnded');

  const residentsListEl = document.getElementById('residentsList');
  const callingPillText = document.getElementById('callingPillText');
  const callingTargetTitle = document.getElementById('callingTargetTitle');
  const callingNotice = document.getElementById('callingNotice');
  const connectedResidentAvatar = document.getElementById('connectedResidentAvatar');
  const inCallBadgeText = document.getElementById('inCallBadgeText');
  const callTimerEl = document.getElementById('callTimer');

  const remoteVideoContainer = document.getElementById('remoteVideoContainer');
  const remoteVideo = document.getElementById('remoteVideo');
  const localVideoContainer = document.getElementById('localVideoContainer');
  const localVideo = document.getElementById('localVideo');
  const voiceOnlyContainer = document.getElementById('voiceOnlyContainer');
  const remoteAudio = document.getElementById('remoteAudio');

  // Controles de Mídia do Rodapé
  const btnToggleMic = document.getElementById('btnToggleMic');
  const labelMic = document.getElementById('labelMic');
  const btnToggleSpeaker = document.getElementById('btnToggleSpeaker');
  const labelSpeaker = document.getElementById('labelSpeaker');
  const btnToggleVideo = document.getElementById('btnToggleVideo');
  const labelVideo = document.getElementById('labelVideo');
  const btnEndCall = document.getElementById('btnEndCall');
  const btnRestart = document.getElementById('btnRestart');

  // Variáveis de Estado
  let socket = null;
  let peerConnection = null;
  let localStream = null;
  let localAudioTrack = null;
  let localVideoTrack = null;

  // PADRÃO ENTREGADOR: Microfone LIGADO, Viva-Voz LIGADO e Vídeo LIGADO
  let isVideoEnabled = true;
  let isMicMuted = false;
  let isSpeakerOn = true;

  let callTimerInterval = null;
  let callSeconds = 0;
  let audioContext = null;
  let ringToneInterval = null;
  let connectedOwnerSocketId = null;
  let selectedResident = null;
  let residentsList = [];

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' }
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

      switchState('incall');
      startTimer();
      await startMediaAndWebRTC();
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

    // Resposta WebRTC enviada pelo Morador
    socket.on('webrtc-answer', async ({ answer }) => {
      try {
        if (peerConnection) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
      } catch (err) {
        console.error('Erro ao definir resposta WebRTC:', err);
      }
    });

    // Caso o morador decida ligar a câmera depois e envie uma oferta de renegociação
    socket.on('webrtc-offer', async ({ offer, from }) => {
      try {
        if (!peerConnection) await createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('webrtc-answer', { doorbellId, answer, to: from });
      } catch (err) {
        console.error('Erro na renegociação WebRTC do morador:', err);
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

    // Notificação de quando o morador liga ou desliga a câmera dele
    socket.on('video-state-changed', ({ isVideoActive }) => {
      handleRemoteVideoState(isVideoActive);
    });

    socket.on('remote-video-state-changed', ({ isVideoActive }) => {
      handleRemoteVideoState(isVideoActive);
    });
  }

  function handleRemoteVideoState(isVideoActive) {
    if (isVideoActive) {
      remoteVideoContainer.classList.remove('hidden');
      voiceOnlyContainer.style.opacity = '0.15';
    } else {
      remoteVideoContainer.classList.add('hidden');
      voiceOnlyContainer.style.opacity = '1';
    }
  }

  // RENDERIZA A LISTA DE MORADORES
  function renderResidentsSelection() {
    if (!residentsList || residentsList.length === 0) {
      residentsListEl.innerHTML = `
        <div style="text-align:center; padding: 24px 12px; width: 100%;">
          <p style="color:#94a3b8; margin-bottom:16px; font-size: 0.95rem;">Toque abaixo para tocar a campainha da casa:</p>
          <button type="button" id="btnRingGeneral" class="btn-primary" style="padding:14px 24px; font-size:1.1rem; border-radius:50px; width:100%; max-width: 300px; margin: 0 auto; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <svg style="width:20px;height:20px;" viewBox="0 0 24 24" fill="currentColor">
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

    // Se houver apenas 1 morador cadastrado, toca diretamente
    if (residentsList.length === 1 && !selectedResident) {
      triggerCallToResident(residentsList[0]);
      return;
    }

    residentsListEl.innerHTML = '';
    residentsList.forEach(res => {
      const card = document.createElement('div');
      card.className = 'resident-card-btn';
      
      const avatarHtml = res.photo 
        ? `<img class="res-avatar" src="${res.photo}" alt="${res.name}">` 
        : `<div class="res-avatar">${(res.name || 'M').charAt(0).toUpperCase()}</div>`;

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

  // DISPARAR CHAMADA PARA UM MORADOR ESPECÍFICO
  function triggerCallToResident(res) {
    selectedResident = res;
    callingPillText.textContent = `TOCANDO: ${res.unit.toUpperCase()}...`;
    callingTargetTitle.textContent = `${res.name} (${res.unit})`;
    callingNotice.innerHTML = `Chamando <strong>${res.name}</strong> na <strong>${res.unit}</strong>. O celular deste morador está tocando!`;

    // Entra imediatamente na tela de chamada com os controles visíveis
    switchState('calling');
    playRingbackTone();

    // Inicia câmera e microfone por padrão do lado do entregador
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

  // CONTROLE DE NAVEGAÇÃO DE ESTADOS
  function switchState(state) {
    stateSelectResident.classList.remove('active');
    stateCall.classList.remove('active');
    stateEnded.classList.remove('active');

    if (state === 'select') {
      stateSelectResident.classList.add('active');
    } else if (state === 'calling') {
      stateCall.classList.add('active');
      callingSection.classList.remove('hidden');
      inCallSection.classList.add('hidden');
    } else if (state === 'incall') {
      stateCall.classList.add('active');
      callingSection.classList.add('hidden');
      inCallSection.classList.remove('hidden');
    } else if (state === 'ended') {
      stateEnded.classList.add('active');
    }
  }

  // SOLICITA ÁUDIO E VÍDEO CEDO (PADRÃO ENTREGADOR: CÂMERA E MICROFONE ATIVOS)
  async function requestMediaEarly() {
    // Reset de botões para o padrão inicial do entregador
    isMicMuted = false;
    isSpeakerOn = true;
    isVideoEnabled = true;

    btnToggleMic.classList.add('active');
    btnToggleMic.classList.remove('muted');
    labelMic.textContent = 'Microfone';

    btnToggleSpeaker.classList.add('active');
    labelSpeaker.textContent = 'Viva-Voz';

    btnToggleVideo.classList.add('video-on', 'active');
    labelVideo.textContent = 'Câmera';

    try {
      // Tenta obter ÁUDIO e VÍDEO (câmera frontal por padrão)
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
        localVideo.srcObject = localStream;
        localVideoContainer.classList.remove('hidden');
      }
    } catch (err) {
      console.warn('Não foi possível obter áudio + vídeo juntos, tentando apenas áudio:', err);
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
        btnToggleVideo.classList.remove('video-on', 'active');
        labelVideo.textContent = 'Câmera Desligada';
      } catch (errAudio) {
        console.error('Permissão de microfone negada:', errAudio);
      }
    }
  }

  // GERAR TOM DE CHAMADA (BIP)
  function playRingbackTone() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!audioContext) audioContext = new AudioCtx();
      if (audioContext.state === 'suspended') audioContext.resume();

      const playBeep = () => {
        if (!stateCall.classList.contains('active') || callingSection.classList.contains('hidden')) return;
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

  // INICIALIZA CONEXÃO WEBRTC QUANDO O MORADOR ATENDE
  async function startMediaAndWebRTC() {
    if (!localStream) {
      await requestMediaEarly();
    }

    await createPeerConnection();

    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    // O entregador inicia a oferta com áudio e vídeo
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
    if (peerConnection) {
      try { peerConnection.close(); } catch(e) {}
    }

    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && connectedOwnerSocketId) {
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
        remoteAudio.volume = isSpeakerOn ? 1.0 : 0.35;
        remoteAudio.play().catch(e => console.log('Erro ao reproduzir áudio remoto:', e));
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

  // 1. MUTAR / DESMUTAR MICROFONE
  function toggleMic() {
    isMicMuted = !isMicMuted;
    if (localAudioTrack) {
      localAudioTrack.enabled = !isMicMuted;
    }
    if (isMicMuted) {
      btnToggleMic.classList.add('muted');
      btnToggleMic.classList.remove('active');
      labelMic.textContent = 'Mudo';
    } else {
      btnToggleMic.classList.remove('muted');
      btnToggleMic.classList.add('active');
      labelMic.textContent = 'Microfone';
    }
  }

  // 2. ALTERNAR VIVA-VOZ
  function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    if (isSpeakerOn) {
      btnToggleSpeaker.classList.add('active');
      labelSpeaker.textContent = 'Viva-Voz';
      if (remoteAudio) {
        remoteAudio.volume = 1.0;
        if (typeof remoteAudio.setSinkId === 'function') {
          remoteAudio.setSinkId('').catch(() => {});
        }
      }
    } else {
      btnToggleSpeaker.classList.remove('active');
      labelSpeaker.textContent = 'Normal';
      if (remoteAudio) {
        remoteAudio.volume = 0.35;
      }
    }
  }

  // 3. LIGAR / DESLIGAR CÂMERA DO ENTREGADOR
  async function toggleVideo() {
    if (!isVideoEnabled) {
      // Ligar Câmera
      try {
        if (!localVideoTrack || localVideoTrack.readyState === 'ended') {
          const videoStream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 640 },
              height: { ideal: 480 }
            }
          });
          localVideoTrack = videoStream.getVideoTracks()[0];
          if (localStream) {
            localStream.addTrack(localVideoTrack);
          } else {
            localStream = videoStream;
          }
          if (peerConnection) {
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
          }
        } else {
          localVideoTrack.enabled = true;
        }

        localVideo.srcObject = new MediaStream([localVideoTrack]);
        localVideoContainer.classList.remove('hidden');
        isVideoEnabled = true;
        btnToggleVideo.classList.add('video-on', 'active');
        labelVideo.textContent = 'Câmera';

        if (connectedOwnerSocketId) {
          socket.emit('video-state-changed', { doorbellId, isVideoActive: true, to: connectedOwnerSocketId });
        }
      } catch (err) {
        alert('Não foi possível ativar a câmera.');
      }
    } else {
      // Desligar Câmera
      isVideoEnabled = false;
      if (localVideoTrack) {
        localVideoTrack.enabled = false;
      }
      localVideoContainer.classList.add('hidden');
      btnToggleVideo.classList.remove('video-on', 'active');
      labelVideo.textContent = 'Câmera Desligada';

      if (connectedOwnerSocketId) {
        socket.emit('video-state-changed', { doorbellId, isVideoActive: false, to: connectedOwnerSocketId });
      }
    }
  }

  // 4. ENCERRAR OU CANCELAR CHAMADA
  function endCall() {
    stopRingbackTone();
    if (callingSection && !callingSection.classList.contains('hidden')) {
      socket.emit('reject-call', { doorbellId });
    } else {
      socket.emit('end-call', { doorbellId });
    }
    cleanupMedia();
    switchState('ended');
  }

  // CRONÔMETRO DE CHAMADA
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

    isVideoEnabled = true;
    isMicMuted = false;
    isSpeakerOn = true;
    connectedOwnerSocketId = null;
  }

  // EVENT LISTENERS DOS CONTROLES
  btnToggleMic.addEventListener('click', toggleMic);
  btnToggleSpeaker.addEventListener('click', toggleSpeaker);
  btnToggleVideo.addEventListener('click', toggleVideo);
  btnEndCall.addEventListener('click', endCall);

  btnRestart.addEventListener('click', () => {
    if (residentsList.length > 1) {
      switchState('select');
    } else if (residentsList.length === 1) {
      triggerCallToResident(residentsList[0]);
    } else {
      switchState('select');
    }
  });

  initSocket();

})();
