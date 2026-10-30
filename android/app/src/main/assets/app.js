// APLICATIVO DO MORADOR E VIZINHOS (ANDROID)
// Autenticação por código (960499622@@), foto de perfil, gestão de vizinhos e viva-voz automático.

(function() {
  'use strict';

  const MASTER_CODE = '960499622@@';
  const STORAGE_RESIDENT = 'campainha_resident_user';
  const STORAGE_CONFIG = 'campainha_config';

  let config = {
    doorbellId: 'minha-casa',
    title: 'Vila Residencial',
    address: 'Rua Principal, 123',
    serverUrl: window.location.origin.includes('http') ? window.location.origin : 'https://campainha-digital.onrender.com'
  };

  const savedConfig = localStorage.getItem(STORAGE_CONFIG);
  if (savedConfig) {
    try { config = { ...config, ...JSON.parse(savedConfig) }; } catch(e) {}
  }

  // Backup persistente de configuração no Android nativo
  if (window.AndroidBridge && window.AndroidBridge.getSavedServerConfig) {
    try {
      const nativeCfg = window.AndroidBridge.getSavedServerConfig();
      if (nativeCfg) config = { ...config, ...JSON.parse(nativeCfg) };
    } catch(e) {}
  }

  let currentResident = null;
  const savedResident = localStorage.getItem(STORAGE_RESIDENT);
  if (savedResident) {
    try { currentResident = JSON.parse(savedResident); } catch(e) {}
  }

  // Backup persistente da sessão no Android nativo (SharedPreferences)
  if (!currentResident && window.AndroidBridge && window.AndroidBridge.getSavedSession) {
    try {
      const nativeRes = window.AndroidBridge.getSavedSession();
      if (nativeRes) {
        currentResident = JSON.parse(nativeRes);
        localStorage.setItem(STORAGE_RESIDENT, nativeRes);
      }
    } catch(e) {}
  }

  // Banco local persistente de perfis salvos (Admin e Usuários Padrão)
  const STORAGE_SAVED_PROFILES = 'campainha_saved_profiles';
  let savedProfiles = {};
  try {
    const sp = localStorage.getItem(STORAGE_SAVED_PROFILES);
    if (sp) savedProfiles = JSON.parse(sp);
  } catch(e) {}

  // Gravação de Áudio e Vídeo das Chamadas (Exclusivo Administrador)
  let callMediaRecorder = null;
  let callRecordedChunks = [];
  let callRecordIsVideo = false;

  // Variáveis da Chamada WebRTC
  let socket = null;
  let peerConnection = null;
  let localStream = null;
  let localAudioTrack = null;
  let localVideoTrack = null;
  let isVideoEnabled = false;
  let isMicMuted = false;
  let isSpeakerOn = true; // VIVA-VOZ ATIVO POR PADRÃO!
  let callTimerInterval = null;
  let callSeconds = 0;
  let currentIncomingCall = null;
  let allResidentsList = [];
  let queuedIceCandidates = [];

  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Telas
  const viewLogin = document.getElementById('viewLogin');
  const viewProfileSetup = document.getElementById('viewProfileSetup');
  const viewDashboard = document.getElementById('viewDashboard');
  const viewIncomingCall = document.getElementById('viewIncomingCall');
  const viewInCall = document.getElementById('viewInCall');

  // Tela Login Código
  const inputAccessCode = document.getElementById('inputAccessCode');
  const btnToggleShowCode = document.getElementById('btnToggleShowCode');
  const btnVerifyCode = document.getElementById('btnVerifyCode');
  const codeErrorMsg = document.getElementById('codeErrorMsg');

  // Tela Perfil Setup & Foto
  const setupTitle = document.getElementById('setupTitle');
  const setupSubtitle = document.getElementById('setupSubtitle');
  const setupRoleBadge = document.getElementById('setupRoleBadge');
  const avatarPreviewContainer = document.getElementById('avatarPreviewContainer');
  const avatarPreviewImg = document.getElementById('avatarPreviewImg');
  const avatarPlaceholder = document.getElementById('avatarPlaceholder');
  const avatarFileInput = document.getElementById('avatarFileInput');
  const btnChoosePhoto = document.getElementById('btnChoosePhoto');
  const setupName = document.getElementById('setupName');
  const setupUnit = document.getElementById('setupUnit');
  const btnSaveProfileSetup = document.getElementById('btnSaveProfileSetup');

  // Dashboard
  const dashRoleBadge = document.getElementById('dashRoleBadge');
  const standardUserBanner = document.getElementById('standardUserBanner');
  const dashAvatarImg = document.getElementById('dashAvatarImg');
  const dashAvatarInitial = document.getElementById('dashAvatarInitial');
  const dashResidentName = document.getElementById('dashResidentName');
  const dashResidentUnit = document.getElementById('dashResidentUnit');
  const btnEditMyProfile = document.getElementById('btnEditMyProfile');
  const btnLogout = document.getElementById('btnLogout');
  const modalConfirmLogout = document.getElementById('modalConfirmLogout');
  const btnCancelLogout = document.getElementById('btnCancelLogout');
  const btnConfirmLogout = document.getElementById('btnConfirmLogout');
  const updateBanner = document.getElementById('updateBanner');
  const updateText = document.getElementById('updateText');
  const btnDownloadUpdate = document.getElementById('btnDownloadUpdate');
  const connStatusText = document.getElementById('connStatusText');
  const statusDot = document.getElementById('statusDot');
  const badgeUnitDisplay = document.getElementById('badgeUnitDisplay');
  const dashDoorbellTitle = document.getElementById('dashDoorbellTitle');
  const dashAddressText = document.getElementById('dashAddressText');
  const doorbellIdBadge = document.getElementById('doorbellIdBadge');
  const dashResidentsList = document.getElementById('dashResidentsList');

  // Ações do Dashboard
  const btnOpenSignModal = document.getElementById('btnOpenSignModal');
  const btnOpenResidentsModal = document.getElementById('btnOpenResidentsModal');
  const btnOpenConfigModal = document.getElementById('btnOpenConfigModal');
  const btnTestRing = document.getElementById('btnTestRing');

  // Chamada Chegando
  const incomingTargetBadge = document.getElementById('incomingTargetBadge');
  const incomingAddress = document.getElementById('incomingAddress');
  const incomingTime = document.getElementById('incomingTime');
  const btnAnswerCall = document.getElementById('btnAnswerCall');
  const btnRejectCall = document.getElementById('btnRejectCall');

  // Chamada Ativa
  const ownerVoiceContainer = document.getElementById('ownerVoiceContainer');
  const ownerRemoteVideoContainer = document.getElementById('ownerRemoteVideoContainer');
  const ownerLocalVideoContainer = document.getElementById('ownerLocalVideoContainer');
  const ownerRemoteVideo = document.getElementById('ownerRemoteVideo');
  const ownerLocalVideo = document.getElementById('ownerLocalVideo');
  const ownerRemoteAudio = document.getElementById('ownerRemoteAudio');
  const ownerCallTimer = document.getElementById('ownerCallTimer');

  const btnOwnerToggleMic = document.getElementById('btnOwnerToggleMic');
  const labelOwnerMic = document.getElementById('labelOwnerMic');
  const btnOwnerToggleSpeaker = document.getElementById('btnOwnerToggleSpeaker');
  const labelOwnerSpeaker = document.getElementById('labelOwnerSpeaker');
  const btnOwnerToggleVideo = document.getElementById('btnOwnerToggleVideo');
  const labelOwnerVideo = document.getElementById('labelOwnerVideo');
  const btnOwnerEndCall = document.getElementById('btnOwnerEndCall');

  // Modais
  const modalResidents = document.getElementById('modalResidents');
  const modalSign = document.getElementById('modalSign');
  const modalConfig = document.getElementById('modalConfig');
  const btnCloseResidentsModal = document.getElementById('btnCloseResidentsModal');
  const btnCloseSignModal = document.getElementById('btnCloseSignModal');
  const btnCloseConfigModal = document.getElementById('btnCloseConfigModal');

  // Gerenciador de Usuários, Convites & RBAC
  const residentsManagerList = document.getElementById('residentsManagerList');
  const tabBtnUsers = document.getElementById('tabBtnUsers');
  const tabBtnInvite = document.getElementById('tabBtnInvite');
  const tabBtnPending = document.getElementById('tabBtnPending');
  const tabContentUsers = document.getElementById('tabContentUsers');
  const tabContentInvite = document.getElementById('tabContentInvite');
  const tabContentPending = document.getElementById('tabContentPending');

  const inputInviteEmail = document.getElementById('inputInviteEmail');
  const inputInviteUnit = document.getElementById('inputInviteUnit');
  const btnCreateInviteSubmit = document.getElementById('btnCreateInviteSubmit');
  const generatedInviteBox = document.getElementById('generatedInviteBox');
  const displayInviteCode = document.getElementById('displayInviteCode');
  const displayInviteCodeText = document.getElementById('displayInviteCodeText');
  const displayInviteMeta = document.getElementById('displayInviteMeta');
  const btnCopyInviteCode = document.getElementById('btnCopyInviteCode');
  const btnCopyInviteText = document.getElementById('btnCopyInviteText');
  const btnShareInvite = document.getElementById('btnShareInvite');
  const pendingInvitesList = document.getElementById('pendingInvitesList');
  let pendingInvite = null;

  // Placa
  const signTitle = document.getElementById('signTitle');
  const signAddress = document.getElementById('signAddress');
  const signQrCode = document.getElementById('signQrCode');
  const btnPrintSign = document.getElementById('btnPrintSign');
  const btnShareSignLink = document.getElementById('btnShareSignLink');

  // Config
  const cfgTitle = document.getElementById('cfgTitle');
  const cfgAddress = document.getElementById('cfgAddress');
  const cfgServerUrl = document.getElementById('cfgServerUrl');
  const btnSaveConfig = document.getElementById('btnSaveConfig');

  // Atualização no Login
  const loginUpdateBanner = document.getElementById('loginUpdateBanner');
  const loginUpdateText = document.getElementById('loginUpdateText');
  const btnLoginDownloadUpdate = document.getElementById('btnLoginDownloadUpdate');

  // Bridge Android Nativa
  const Android = {
    playDoorbellRingtone: () => {
      if (window.AndroidBridge && window.AndroidBridge.playDoorbellRingtone) {
        window.AndroidBridge.playDoorbellRingtone();
      }
    },
    stopDoorbellRingtone: () => {
      if (window.AndroidBridge && window.AndroidBridge.stopDoorbellRingtone) {
        window.AndroidBridge.stopDoorbellRingtone();
      }
    },
    setSpeakerphoneOn: (on) => {
      if (window.AndroidBridge && window.AndroidBridge.setSpeakerphoneOn) {
        window.AndroidBridge.setSpeakerphoneOn(on);
      }
    },
    resetAudioMode: () => {
      if (window.AndroidBridge && window.AndroidBridge.resetAudioMode) {
        window.AndroidBridge.resetAudioMode();
      }
    },
    openExternalUrl: (url) => {
      if (window.AndroidBridge && window.AndroidBridge.openExternalUrl) {
        window.AndroidBridge.openExternalUrl(url);
      } else {
        window.open(url, '_blank');
      }
    },
    installApkUpdate: (url) => {
      if (window.AndroidBridge && window.AndroidBridge.installApkUpdate) {
        window.AndroidBridge.installApkUpdate(url);
      } else {
        Android.openExternalUrl(url);
      }
    },
    shareDoorbellInvite: (text) => {
      if (window.AndroidBridge && window.AndroidBridge.shareDoorbellInvite) {
        window.AndroidBridge.shareDoorbellInvite(text);
      } else if (navigator.share) {
        navigator.share({ title: 'Campainha Digital', text });
      } else {
        alert(text);
      }
    },
    printQrSign: () => {
      if (window.AndroidBridge && window.AndroidBridge.printQrSign) {
        window.AndroidBridge.printQrSign();
      } else {
        window.print();
      }
    },
    showToast: (msg) => {
      if (window.AndroidBridge && window.AndroidBridge.showToast) {
        window.AndroidBridge.showToast(msg);
      }
    },
    copyToClipboard: async (text) => {
      if (!text) return false;
      let copied = false;
      if (window.AndroidBridge && window.AndroidBridge.copyToClipboard) {
        try {
          window.AndroidBridge.copyToClipboard(text);
          copied = true;
        } catch(e) {}
      }
      if (!copied && navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
          Android.showToast('Código copiado!');
        } catch(e) {}
      }
      if (!copied) {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          Android.showToast('Código copiado!');
          copied = true;
        } catch(e) {}
      }
      return copied;
    }
  };

  // 1. Navegação de Telas
  function switchScreen(viewName) {
    viewLogin.classList.remove('active');
    viewProfileSetup.classList.remove('active');
    viewDashboard.classList.remove('active');
    viewIncomingCall.classList.remove('active');
    viewInCall.classList.remove('active');

    if (viewName === 'login') viewLogin.classList.add('active');
    if (viewName === 'setup') viewProfileSetup.classList.add('active');
    if (viewName === 'dashboard') viewDashboard.classList.add('active');
    if (viewName === 'incoming') viewIncomingCall.classList.add('active');
    if (viewName === 'incall') viewInCall.classList.add('active');
  }

  // 2. Autenticação e RBAC por Código (Administradora ou Convite de Usuário)
  btnVerifyCode.addEventListener('click', async () => {
    const code = inputAccessCode.value.trim();
    if (!code) return;

    btnVerifyCode.disabled = true;
    btnVerifyCode.textContent = 'Verificando...';

    try {
      let verified = false;

      // 1. Tenta validar no servidor SQLite
      if (config.serverUrl) {
        try {
          const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/auth/verify-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
          });

          if (res.ok) {
            const data = await res.json();
            verified = true;
            codeErrorMsg.classList.add('hidden');

            if (data.type === 'invite') {
              if (savedProfiles[code] && savedProfiles[code].name) {
                // Perfil já configurado anteriormente no aparelho
                currentResident = savedProfiles[code];
                currentResident.code = code;
                saveResidentLocally();
                renderDashboard();
                connectSocket();
                switchScreen('dashboard');
                return;
              }
              // Convite pendente para Convidado novo
              pendingInvite = data.invite;
              setupTitle.textContent = '🎉 Cadastro de Convidado';
              setupSubtitle.textContent = `Você foi convidado(a) como Usuário Padrão para a ${data.invite.unit}. Preencha seu nome e escolha sua foto:`;
              setupRoleBadge.className = 'badge-role-user';
              setupRoleBadge.textContent = '👤 Usuário Padrão';
              setupName.value = '';
              setupUnit.value = data.invite.unit;
              setupUnit.disabled = true;
              switchScreen('setup');
              return;
            } else if (data.type === 'user') {
              // Usuário já cadastrado (Admin ou Convidado)
              const localCached = savedProfiles[code] || {};
              currentResident = { ...localCached, ...data.user };
              if (!currentResident.photo && localCached.photo) {
                currentResident.photo = localCached.photo;
              }
              currentResident.code = code;
              currentResident.isAdmin = (currentResident.role === 'admin');
              saveResidentLocally();
              renderDashboard();
              connectSocket();
              switchScreen('dashboard');
              return;
            }
          }
        } catch(netErr) {}
      }

      // 2. Se houver perfil já salvo neste aparelho para este código (Admin ou Morador)
      if (savedProfiles[code] && savedProfiles[code].name) {
        codeErrorMsg.classList.add('hidden');
        currentResident = savedProfiles[code];
        currentResident.code = code;
        currentResident.isAdmin = (currentResident.role === 'admin');
        saveResidentLocally();
        renderDashboard();
        connectSocket();
        switchScreen('dashboard');
        return;
      }

      // 3. Fallback offline local para a Administradora (código mestre)
      if (code === MASTER_CODE) {
        codeErrorMsg.classList.add('hidden');
        const adminCached = savedProfiles[MASTER_CODE] || {
          id: 'usr_admin_1',
          name: 'Administradora',
          unit: 'Casa 1',
          photo: '',
          role: 'admin',
          isAdmin: true,
          code: MASTER_CODE
        };
        currentResident = adminCached;
        saveResidentLocally();
        renderDashboard();
        connectSocket();
        switchScreen('dashboard');
        return;
      }

      // Se o código não foi reconhecido pelo servidor nem localmente:
      codeErrorMsg.classList.remove('hidden');
      codeErrorMsg.textContent = 'Código de acesso ou convite incorreto. Tente novamente.';
    } catch (err) {
      codeErrorMsg.classList.remove('hidden');
      codeErrorMsg.textContent = 'Erro ao processar login. Tente novamente.';
    } finally {
      btnVerifyCode.disabled = false;
      btnVerifyCode.textContent = 'Entrar no Aplicativo';
    }
  });

  btnToggleShowCode.addEventListener('click', () => {
    inputAccessCode.type = inputAccessCode.type === 'password' ? 'text' : 'password';
  });

  inputAccessCode.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      btnVerifyCode.click();
    }
  });

  // 3. Escolher Foto de Perfil
  btnChoosePhoto.addEventListener('click', () => {
    avatarFileInput.click();
  });

  avatarFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64Img = event.target.result;
        avatarPreviewImg.src = base64Img;
        avatarPreviewImg.classList.remove('hidden');
        avatarPlaceholder.classList.add('hidden');
        if (currentResident) {
          currentResident.photo = base64Img;
        }
      };
      reader.readAsDataURL(file);
    }
  });

  btnSaveProfileSetup.addEventListener('click', async () => {
    const name = setupName.value.trim();
    const unit = setupUnit.value.trim();

    if (!name) {
      alert('Por favor, informe seu nome completo.');
      return;
    }

    const photo = avatarPreviewImg.src && !avatarPreviewImg.classList.contains('hidden') ? avatarPreviewImg.src : '';

    // Se estiver completando cadastro de convite como Usuário Padrão (RBAC)
    if (pendingInvite) {
      btnSaveProfileSetup.disabled = true;
      btnSaveProfileSetup.textContent = 'Cadastrando Usuário...';
      try {
        const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/auth/register-invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: pendingInvite.code,
            name,
            photo
          })
        });

        if (res.ok) {
          const data = await res.json();
          currentResident = data.user;
          currentResident.isAdmin = false;
          currentResident.role = 'user';
          pendingInvite = null;
          saveResidentLocally();
          renderDashboard();
          connectSocket();
          switchScreen('dashboard');
          return;
        } else {
          const err = await res.json();
          alert('Erro no cadastro: ' + (err.error || 'Tente novamente.'));
        }
      } catch (e) {
        alert('Não foi possível conectar ao servidor para aceitar o convite.');
      } finally {
        btnSaveProfileSetup.disabled = false;
        btnSaveProfileSetup.textContent = 'Concluir Cadastro e Entrar';
      }
      return;
    }

    // Perfil normal / Administradora
    if (!currentResident) {
      currentResident = {
        id: 'usr_admin_1',
        name,
        unit: unit || 'Casa 1',
        photo,
        role: 'admin',
        isAdmin: true,
        code: MASTER_CODE
      };
    } else {
      currentResident.name = name;
      currentResident.unit = unit || currentResident.unit;
      if (photo) currentResident.photo = photo;
    }

    saveResidentLocally();
    renderDashboard();
    connectSocket();
    syncResidentWithServer();
    switchScreen('dashboard');
  });

  btnEditMyProfile.addEventListener('click', () => {
    const isAdmin = currentResident && (currentResident.role === 'admin' || currentResident.isAdmin);
    setupTitle.textContent = isAdmin ? 'Editar Perfil da Administradora' : 'Editar Meu Perfil';
    setupSubtitle.textContent = 'Altere seu nome ou foto de identificação no portão:';
    setupRoleBadge.className = isAdmin ? 'badge-role-admin' : 'badge-role-user';
    setupRoleBadge.textContent = isAdmin ? '👑 Administradora' : '👤 Usuário Padrão';
    setupName.value = currentResident.name || '';
    setupUnit.value = currentResident.unit || '';
    setupUnit.disabled = !isAdmin;
    if (currentResident.photo) {
      avatarPreviewImg.src = currentResident.photo;
      avatarPreviewImg.classList.remove('hidden');
      avatarPlaceholder.classList.add('hidden');
    } else {
      avatarPreviewImg.classList.add('hidden');
      avatarPlaceholder.classList.remove('hidden');
    }
    switchScreen('setup');
  });

  // Modal Customizado e Elegante de Sair da Conta (Sem pop-ups com "file://")
  btnLogout.addEventListener('click', () => {
    if (modalConfirmLogout) {
      modalConfirmLogout.classList.add('open');
    } else {
      doLogout();
    }
  });

  if (btnCancelLogout) {
    btnCancelLogout.addEventListener('click', () => {
      if (modalConfirmLogout) modalConfirmLogout.classList.remove('open');
    });
  }

  if (btnConfirmLogout) {
    btnConfirmLogout.addEventListener('click', () => {
      if (modalConfirmLogout) modalConfirmLogout.classList.remove('open');
      doLogout();
    });
  }

  function doLogout() {
    localStorage.removeItem(STORAGE_RESIDENT);
    if (window.AndroidBridge && window.AndroidBridge.clearSession) {
      try { window.AndroidBridge.clearSession(); } catch(e) {}
    }
    currentResident = null;
    if (socket) socket.disconnect();
    switchScreen('login');
    Android.showToast('Você saiu da sua conta.');
  }

  function saveResidentLocally() {
    if (currentResident) {
      const codeKey = currentResident.code || currentResident.access_code || (currentResident.role === 'admin' ? MASTER_CODE : null);
      if (codeKey) {
        savedProfiles[codeKey] = { ...currentResident, code: codeKey };
        localStorage.setItem(STORAGE_SAVED_PROFILES, JSON.stringify(savedProfiles));
      }
      const json = JSON.stringify(currentResident);
      localStorage.setItem(STORAGE_RESIDENT, json);
      if (window.AndroidBridge && window.AndroidBridge.saveSession) {
        try { window.AndroidBridge.saveSession(json); } catch(e) {}
      }
    }
  }

  function saveConfigLocally() {
    const json = JSON.stringify(config);
    localStorage.setItem(STORAGE_CONFIG, json);
    if (window.AndroidBridge && window.AndroidBridge.saveServerConfig) {
      try { window.AndroidBridge.saveServerConfig(json); } catch(e) {}
    }
  }

  // 4. Renderização do Dashboard com Controle de Acesso Baseado em Regras (RBAC)
  function renderDashboard() {
    if (!currentResident) return;

    const isAdmin = (currentResident.role === 'admin' || currentResident.isAdmin);

    dashResidentName.textContent = currentResident.name;
    dashResidentUnit.textContent = currentResident.unit;

    if (dashRoleBadge) {
      if (isAdmin) {
        dashRoleBadge.className = 'badge-role-admin';
        dashRoleBadge.textContent = '👑 Admin';
      } else {
        dashRoleBadge.className = 'badge-role-user';
        dashRoleBadge.textContent = '👤 Convidado';
      }
    }

    // AVISO VISÍVEL APENAS PARA USUÁRIO PADRÃO
    if (standardUserBanner) {
      if (isAdmin) {
        standardUserBanner.classList.add('hidden');
      } else {
        standardUserBanner.classList.remove('hidden');
      }
    }

    // RESTRINGE ACESSO: ESCONDE BOTÕES DE CONFIGURAÇÃO, PLACA E GESTÃO PARA USUÁRIO PADRÃO
    document.querySelectorAll('.admin-only').forEach(el => {
      if (isAdmin) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });

    badgeUnitDisplay.textContent = currentResident.unit;

    if (currentResident.photo) {
      dashAvatarImg.src = currentResident.photo;
      dashAvatarImg.classList.remove('hidden');
      dashAvatarInitial.classList.add('hidden');
    } else {
      dashAvatarImg.classList.add('hidden');
      dashAvatarInitial.classList.remove('hidden');
      dashAvatarInitial.textContent = currentResident.name.charAt(0).toUpperCase();
    }

    dashDoorbellTitle.textContent = config.title;
    dashAddressText.textContent = config.address;
    doorbellIdBadge.textContent = `ID: ${config.doorbellId}`;

    signTitle.textContent = config.title;
    signAddress.textContent = config.address;

    cfgTitle.value = config.title;
    cfgAddress.value = config.address;
    cfgServerUrl.value = config.serverUrl;

    if (isAdmin) {
      generateQrCodes();
      loadAdminUsersAndInvites();
    }

    checkServerUpdate();
  }

  // 5. Verificação e Atualização Direta do Aplicativo
  async function checkServerUpdate() {
    if (!config.serverUrl) return;
    try {
      const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/version`);
      if (res.ok) {
        const data = await res.json();
        let currentVersionCode = 12;
        if (window.AndroidBridge && window.AndroidBridge.getAppVersionCode) {
          try {
            currentVersionCode = window.AndroidBridge.getAppVersionCode();
          } catch(e) {}
        }
        if (data.versionCode && data.versionCode > currentVersionCode) {
          if (updateBanner) updateBanner.classList.remove('hidden');
          if (updateText) updateText.textContent = `Versão ${data.versionName}: ${data.changelog}`;

          if (loginUpdateBanner) loginUpdateBanner.classList.remove('hidden');
          if (loginUpdateText) loginUpdateText.textContent = `Versão ${data.versionName}: ${data.changelog}`;
          
          const doInstallUpdate = () => {
            const downloadUrl = `${config.serverUrl.replace(/\/$/, '')}${data.downloadUrl || '/download'}`;
            // Dispara download e instalação nativa no Android
            Android.installApkUpdate(downloadUrl);
          };

          if (btnDownloadUpdate) btnDownloadUpdate.onclick = doInstallUpdate;
          if (btnLoginDownloadUpdate) btnLoginDownloadUpdate.onclick = doInstallUpdate;
        }
      }
    } catch(e) {}
  }

  // 6. Gerador de QR Code do Portão
  function generateQrCodes() {
    const visitorUrl = `${config.serverUrl.replace(/\/$/, '')}/campainha/${config.doorbellId}`;

    signQrCode.innerHTML = '';
    new QRCode(signQrCode, {
      text: visitorUrl,
      width: 220,
      height: 220,
      colorDark: "#0f172a",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  }

  let currentConnectedUrl = '';

  // 7. Conexão em Tempo Real (Socket.io Estável)
  function connectSocket() {
    // Evita reconectar se o socket já estiver conectado na mesma URL do servidor
    if (socket && socket.connected && currentConnectedUrl === config.serverUrl) {
      console.log('Socket já conectado e ativo.');
      return;
    }

    if (!config.serverUrl) {
      if (connStatusText) {
        connStatusText.textContent = '🔴 Servidor não configurado';
        connStatusText.style.color = '#ef4444';
      }
      return;
    }

    currentConnectedUrl = config.serverUrl;

    if (socket) {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch(e) {}
      socket = null;
    }

    try {
      socket = io(config.serverUrl, {
        transports: ['websocket', 'polling'],
        upgrade: true,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 2500,
        reconnectionDelayMax: 10000,
        timeout: 20000,
        autoConnect: true
      });

      socket.on('connect', () => {
        console.log('[Socket] Conectado com sucesso ao servidor:', config.serverUrl);
        const unitName = (currentResident && currentResident.unit) ? currentResident.unit : 'Geral';
        if (connStatusText) {
          connStatusText.textContent = `🟢 Conectado (${unitName})`;
          connStatusText.style.color = '#4ade80';
        }
        if (statusDot) {
          statusDot.style.background = '#22c55e';
          statusDot.style.boxShadow = '0 0 10px #22c55e';
        }

        // Registra este morador com sua unidade/casa específica
        socket.emit('register-resident', {
          doorbellId: config.doorbellId || 'minha-casa',
          resident: currentResident || {
            id: 'admin_1',
            name: 'Proprietário',
            unit: 'Casa 1',
            isAdmin: true
          }
        });
      });

      socket.on('connect_error', (err) => {
        console.warn('[Socket] Erro ao conectar no servidor:', err ? err.message : err);
        if (connStatusText && (!socket || !socket.connected)) {
          connStatusText.textContent = '🔴 Servidor Offline / Reconectando...';
          connStatusText.style.color = '#ef4444';
        }
        if (statusDot && (!socket || !socket.connected)) {
          statusDot.style.background = '#ef4444';
          statusDot.style.boxShadow = '0 0 10px #ef4444';
        }
      });

      socket.on('disconnect', (reason) => {
        console.log('[Socket] Desconectado:', reason);
        if (reason === 'io client disconnect') return;
        if (connStatusText) {
          connStatusText.textContent = '🟡 Reconectando...';
          connStatusText.style.color = '#f59e0b';
        }
        if (statusDot) {
          statusDot.style.background = '#f59e0b';
          statusDot.style.boxShadow = '0 0 10px #f59e0b';
        }
      });

      socket.on('registered', ({ config: srvConfig }) => {
        if (srvConfig && srvConfig.residents) {
          allResidentsList = srvConfig.residents;
          renderResidentsManager();
        }
      });

      socket.on('residents-updated', (updatedList) => {
        allResidentsList = updatedList || [];
        renderResidentsManager();
      });

      socket.on('resident-removed', ({ residentId }) => {
        if (currentResident && currentResident.id === residentId) {
          alert('Seu acesso a esta campainha foi revogado pelo administrador.');
          localStorage.removeItem(STORAGE_RESIDENT);
          location.reload();
        }
      });

      let lastIncomingCallTime = 0;
      // RECEBE CHAMADA DO PORTÃO
      socket.on('incoming-call', (callData) => {
        const now = Date.now();
        if (currentIncomingCall && (now - lastIncomingCallTime < 4000)) {
          console.log('[Chamada Duplicada Ignorada por Debounce]');
          return;
        }
        lastIncomingCallTime = now;
        console.log('[🔔 EVENTO incoming-call RECEBIDO!]', callData);

        if (!currentResident) {
          const savedResident = localStorage.getItem(STORAGE_RESIDENT);
          if (savedResident) {
            try { currentResident = JSON.parse(savedResident); } catch(e) {}
          }
        }
        if (!currentResident) {
          currentResident = {
            id: 'usr_admin_1',
            name: 'Administradora',
            unit: 'Casa 1',
            isAdmin: true,
            role: 'admin'
          };
        }

        const myId = (currentResident.id || '').trim().toLowerCase();
        const myUnit = (currentResident.unit || 'Casa 1').trim().toLowerCase();
        const myName = (currentResident.name || '').trim().toLowerCase();
        const isAdmin = (currentResident.role === 'admin' || currentResident.isAdmin);

        const targetId = (callData.targetResidentId || '').trim().toLowerCase();
        const targetUnit = (callData.targetUnit || '').trim().toLowerCase();
        const targetName = (callData.targetName || '').trim().toLowerCase();
        const targetRole = (callData.targetRole || '').trim().toLowerCase();

        const isGeneral = !targetUnit || targetUnit === 'geral' || targetId === 'geral';
        const isMatchId = targetId && myId && (myId === targetId || myId.includes(targetId) || targetId.includes(myId));
        const isMatchUnit = targetUnit && myUnit && (myUnit === targetUnit || myUnit.includes(targetUnit) || targetUnit.includes(myUnit));
        const isMatchName = targetName && myName && (myName === targetName || myName.includes(targetName) || targetName.includes(myName));
        const isMatchAdmin = (targetRole === 'admin' && isAdmin);

        let shouldRing = false;

        // Se a chamada é geral, ou se combina com ID, unidade, nome ou se foi para Administradora:
        if (isGeneral || isMatchId || isMatchUnit || isMatchName || isMatchAdmin) {
          shouldRing = true;
        } else if (!allResidentsList || allResidentsList.length <= 1) {
          shouldRing = true;
        } else if (isAdmin && (!targetUnit || targetUnit === 'casa 1')) {
          shouldRing = true;
        }

        if (!shouldRing) {
          console.log(`[Chamada Ignorada] Chamada destinada para: ${callData.targetUnit} (${callData.targetName}). Este aparelho é: ${currentResident.unit} (${currentResident.name})`);
          return;
        }

        console.log('[🔔 TOCANDO A CAMPAINHA NO APARELHO!]', callData);
        currentIncomingCall = callData;

        // Dispara o toque sonoro e vibração do celular
        Android.playDoorbellRingtone();

        const unitDisplay = callData.targetUnit || currentResident.unit || 'Minha Casa';
        const nameDisplay = callData.targetName || currentResident.name || 'Morador';
        incomingTargetBadge.textContent = `CHAMADA PARA: ${unitDisplay.toUpperCase()} (${nameDisplay})`;
        incomingAddress.textContent = config.address || 'Portão Residencial';
        incomingTime.textContent = new Date().toLocaleTimeString('pt-BR');

        switchScreen('incoming');
      });

      socket.on('call-answered-by-peer', ({ byName }) => {
        Android.stopDoorbellRingtone();
        Android.showToast(`Chamada atendida por: ${byName}`);
        currentIncomingCall = null;
        switchScreen('dashboard');
      });

      socket.on('call-rejected', () => {
        Android.stopDoorbellRingtone();
        cleanupCall();
        switchScreen('dashboard');
      });

      socket.on('call-ended', () => {
        Android.stopDoorbellRingtone();
        cleanupCall();
        switchScreen('dashboard');
      });

      // Sinalização WebRTC
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
          flushQueuedIceCandidates();
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          socket.emit('webrtc-answer', { doorbellId: config.doorbellId, answer, to: from });
        } catch (e) {
          console.error('Erro ao responder webrtc-offer:', e);
        }
      });

      socket.on('webrtc-answer', async ({ answer }) => {
        try {
          if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            flushQueuedIceCandidates();
          }
        } catch (e) {
          console.error('Erro ao processar webrtc-answer:', e);
        }
      });

      socket.on('webrtc-ice-candidate', async ({ candidate }) => {
        try {
          if (!candidate) return;
          if (peerConnection && peerConnection.remoteDescription) {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
          } else {
            queuedIceCandidates.push(candidate);
          }
        } catch (e) {
          console.warn('Erro ao adicionar candidato ICE:', e);
        }
      });

      function flushQueuedIceCandidates() {
        if (!peerConnection || !peerConnection.remoteDescription) return;
        while (queuedIceCandidates.length > 0) {
          const c = queuedIceCandidates.shift();
          peerConnection.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
        }
      }

      socket.on('remote-video-state-changed', ({ isVideoActive }) => {
        if (isVideoActive) {
          ownerRemoteVideoContainer.classList.remove('hidden');
          ownerVoiceContainer.style.opacity = '0.15';
        } else {
          ownerRemoteVideoContainer.classList.add('hidden');
          ownerVoiceContainer.style.opacity = '1';
        }
      });

    } catch (e) {}
  }

  // 8. Sincronizar Morador com o Servidor SQLite
  async function syncResidentWithServer() {
    if (!config.serverUrl || !currentResident) return;
    try {
      await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/user/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentResident.id,
          name: currentResident.name,
          unit: currentResident.unit,
          photo: currentResident.photo || '',
          code: currentResident.code || currentResident.access_code
        })
      });
    } catch(e) {}
  }

  // 9. Central de Controle de Acesso & Convites RBAC (Administradora)
  function switchMgrTab(tabName) {
    if (!tabBtnUsers || !tabBtnInvite || !tabBtnPending) return;

    tabBtnUsers.classList.remove('active');
    tabBtnInvite.classList.remove('active');
    tabBtnPending.classList.remove('active');
    tabContentUsers.classList.add('hidden');
    tabContentInvite.classList.add('hidden');
    tabContentPending.classList.add('hidden');

    if (tabName === 'users') {
      tabBtnUsers.classList.add('active');
      tabContentUsers.classList.remove('hidden');
      loadAdminUsersAndInvites();
    } else if (tabName === 'invite') {
      tabBtnInvite.classList.add('active');
      tabContentInvite.classList.remove('hidden');
    } else if (tabName === 'pending') {
      tabBtnPending.classList.add('active');
      tabContentPending.classList.remove('hidden');
      loadAdminUsersAndInvites();
    }
  }

  if (tabBtnUsers) tabBtnUsers.addEventListener('click', () => switchMgrTab('users'));
  if (tabBtnInvite) tabBtnInvite.addEventListener('click', () => switchMgrTab('invite'));
  if (tabBtnPending) tabBtnPending.addEventListener('click', () => switchMgrTab('pending'));

  // Carregar lista de usuários e convites da API do servidor SQLite
  async function loadAdminUsersAndInvites() {
    if (!config.serverUrl || !currentResident || !currentResident.isAdmin) return;
    try {
      const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/admin/users?adminCode=${MASTER_CODE}`);
      if (res.ok) {
        const data = await res.json();
        allResidentsList = data.users || [];
        renderResidentsManager();
        renderPendingInvites(data.invites || []);
      }
    } catch(e) {}
  }

  // Renderizar lista de usuários com cargos RBAC
  function renderResidentsManager() {
    if (!residentsManagerList) return;
    residentsManagerList.innerHTML = '';
    if (dashResidentsList) dashResidentsList.innerHTML = '';

    allResidentsList.forEach(res => {
      const isAdminUser = (res.role === 'admin' || res.isAdmin);
      const roleBadgeHtml = isAdminUser
        ? '<span class="badge-role-admin">👑 Admin</span>'
        : '<span class="badge-role-user">👤 Convidado</span>';

      const avatarHtml = res.photo
        ? `<img class="resident-mgr-avatar" src="${res.photo}" alt="${res.name}">`
        : `<div class="resident-mgr-avatar">${res.name.charAt(0).toUpperCase()}</div>`;

      // Botão Remover SÓ APARECE PARA A ADMINISTRADORA E NUNCA PARA ELA PRÓPRIA
      const removeBtnHtml = (currentResident && currentResident.isAdmin && !isAdminUser && res.id !== currentResident.id)
        ? `<button class="btn-remove-resident" data-id="${res.id}">Remover</button>`
        : '';

      const item = document.createElement('div');
      item.className = 'resident-mgr-item';
      item.innerHTML = `
        <div class="resident-mgr-left">
          ${avatarHtml}
          <div>
            <div class="resident-mgr-name" style="display:flex; align-items:center; gap:6px;">
              ${res.name} ${roleBadgeHtml}
            </div>
            <div class="resident-mgr-unit">${res.unit} ${res.email ? '• ' + res.email : ''}</div>
          </div>
        </div>
        ${removeBtnHtml}
      `;
      residentsManagerList.appendChild(item);

      // No dashboard
      if (dashResidentsList) {
        const dashItem = document.createElement('div');
        dashItem.className = 'dash-res-card';
        dashItem.innerHTML = `
          <div class="dash-res-left">
            ${avatarHtml}
            <div>
              <div class="dash-res-name">${res.name}</div>
              <div class="dash-res-unit">${res.unit}</div>
            </div>
          </div>
          ${roleBadgeHtml}
        `;
        dashResidentsList.appendChild(dashItem);
      }
    });

    // Adiciona listener nos botões de remover
    document.querySelectorAll('.btn-remove-resident:not(.btn-cancel-invite)').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const idToRemove = e.target.getAttribute('data-id');
        if (confirm('Tem certeza que deseja remover este usuário? O acesso dele ao aplicativo será revogado.')) {
          await removeResidentFromServer(idToRemove);
        }
      });
    });
  }

  // Renderizar lista de convites pendentes
  function renderPendingInvites(invites) {
    if (!pendingInvitesList) return;
    pendingInvitesList.innerHTML = '';
    const pending = (invites || []).filter(i => i.status === 'pending');

    if (pending.length === 0) {
      pendingInvitesList.innerHTML = '<div style="color:#64748b; font-size:0.85rem; padding:12px; text-align:center;">Nenhum convite pendente no momento.</div>';
      return;
    }

    pending.forEach(inv => {
      const item = document.createElement('div');
      item.className = 'resident-mgr-item';
      item.innerHTML = `
        <div class="resident-mgr-left">
          <div class="resident-mgr-avatar" style="background:#0f172a; border-color:#f59e0b; color:#f59e0b;">✉️</div>
          <div>
            <div class="resident-mgr-name">${inv.email}</div>
            <div class="resident-mgr-unit">${inv.unit} • Código: <button type="button" class="pending-invite-code-btn btn-copy-pending" data-code="${inv.code}" title="Toque para copiar este código">${inv.code} 📋</button></div>
          </div>
        </div>
        <button class="btn-remove-resident btn-cancel-invite" data-id="${inv.id}">Cancelar</button>
      `;
      pendingInvitesList.appendChild(item);
    });

    // Copiar código de convites pendentes com 1 toque
    document.querySelectorAll('.btn-copy-pending').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const code = e.currentTarget.getAttribute('data-code');
        if (code) {
          await Android.copyToClipboard(code);
          const oldHtml = e.currentTarget.innerHTML;
          e.currentTarget.innerHTML = `${code} ✓`;
          e.currentTarget.style.color = '#4ade80';
          setTimeout(() => {
            e.currentTarget.innerHTML = oldHtml;
            e.currentTarget.style.color = '#38bdf8';
          }, 1500);
        }
      });
    });

    document.querySelectorAll('.btn-cancel-invite').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const idToCancel = e.target.getAttribute('data-id');
        if (confirm('Deseja cancelar este convite?')) {
          try {
            await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/admin/invites/${idToCancel}`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ adminCode: MASTER_CODE })
            });
            Android.showToast('Convite cancelado.');
            loadAdminUsersAndInvites();
          } catch(err) {}
        }
      });
    });
  }

  // Ação de Enviar Convite por E-mail (Administradora)
  if (btnCreateInviteSubmit) {
    btnCreateInviteSubmit.addEventListener('click', async () => {
      const email = inputInviteEmail.value.trim();
      const unit = inputInviteUnit.value.trim() || 'Casa 1';

      if (!email || !email.includes('@')) {
        alert('Por favor, informe um endereço de e-mail válido.');
        return;
      }

      btnCreateInviteSubmit.disabled = true;
      btnCreateInviteSubmit.textContent = 'Gerando Convite...';

      try {
        const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/admin/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            unit,
            adminCode: MASTER_CODE
          })
        });

        const data = await res.json();
        if (data.success) {
          generatedInviteBox.classList.remove('hidden');
          const inviteCode = data.invite.code;
          if (displayInviteCodeText) {
            displayInviteCodeText.textContent = inviteCode;
          } else if (displayInviteCode) {
            displayInviteCode.textContent = inviteCode;
          }
          displayInviteMeta.textContent = `Para: ${data.invite.email} • ${data.invite.unit} (Usuário Padrão)`;

          const handleCopyInviteCode = async () => {
            await Android.copyToClipboard(inviteCode);
            if (displayInviteCode) displayInviteCode.classList.add('copied');
            if (btnCopyInviteText) btnCopyInviteText.textContent = 'Copiado! ✓';
            setTimeout(() => {
              if (displayInviteCode) displayInviteCode.classList.remove('copied');
              if (btnCopyInviteText) btnCopyInviteText.textContent = 'Copiar Código';
            }, 1800);
          };

          if (displayInviteCode) displayInviteCode.onclick = handleCopyInviteCode;
          if (btnCopyInviteCode) btnCopyInviteCode.onclick = handleCopyInviteCode;

          btnShareInvite.onclick = () => {
            const inviteMsg = `Olá! Você foi convidado(a) como Usuário Padrão para a Campainha Digital de ${config.title} (${unit}).\n\n1. Abra o aplicativo da Campainha no seu celular.\n2. Na tela inicial, digite seu código de convite: ${inviteCode}\n\nVocê já estará cadastrado(a) e poderá atender as chamadas do portão com viva-voz e vídeo!`;
            Android.shareDoorbellInvite(inviteMsg);
          };

          inputInviteEmail.value = '';
          inputInviteUnit.value = '';
          Android.showToast('Convite gerado com sucesso!');
          loadAdminUsersAndInvites();
        } else {
          alert('Erro ao gerar convite: ' + (data.error || 'Tente novamente.'));
        }
      } catch(e) {
        alert('Não foi possível conectar ao servidor para gerar o convite.');
      } finally {
        btnCreateInviteSubmit.disabled = false;
        btnCreateInviteSubmit.textContent = 'Gerar Convite de Usuário';
      }
    });
  }

  // Excluir Usuário no Servidor SQLite
  async function removeResidentFromServer(resId) {
    try {
      const res = await fetch(`${config.serverUrl.replace(/\/$/, '')}/api/admin/users/${resId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminCode: MASTER_CODE
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        Android.showToast('Usuário removido com sucesso!');
        loadAdminUsersAndInvites();
      } else {
        alert('Erro: ' + (data.error || 'Não foi possível remover o usuário.'));
      }
    } catch (e) {
      alert('Erro ao remover usuário.');
    }
  }

  // 10. Atender Chamada (VIVA-VOZ ATIVO POR PADRÃO)
  async function answerCall() {
    Android.stopDoorbellRingtone();
    switchScreen('incall');
    startCallTimer();

    // Viva-voz ativado automaticamente
    isSpeakerOn = true;
    Android.setSpeakerphoneOn(true);
    btnOwnerToggleSpeaker.classList.add('active');
    labelOwnerSpeaker.textContent = 'Viva-Voz';

    socket.emit('answer-call', {
      doorbellId: config.doorbellId,
      targetVisitorId: currentIncomingCall ? currentIncomingCall.from : null,
      residentInfo: currentResident
    });

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
      await createPeerConnection();

      localStream.getTracks().forEach(track => {
        const senders = peerConnection.getSenders();
        if (!senders.some(s => s.track === track)) {
          peerConnection.addTrack(track, localStream);
        }
      });

      // Se a oferta do visitante já chegou enquanto o morador atendia:
      if (peerConnection.signalingState === 'have-remote-offer') {
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('webrtc-answer', {
          doorbellId: config.doorbellId,
          answer,
          to: currentIncomingCall ? currentIncomingCall.from : null
        });
      }

    } catch (err) {
      alert('Permissão de microfone necessária para falar com o visitante.');
    }
  }

  function rejectCall() {
    Android.stopDoorbellRingtone();
    socket.emit('reject-call', { doorbellId: config.doorbellId });
    currentIncomingCall = null;
    switchScreen('dashboard');
  }

  async function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          doorbellId: config.doorbellId,
          candidate: event.candidate,
          to: currentIncomingCall ? currentIncomingCall.from : null
        });
      }
    };

    peerConnection.ontrack = (event) => {
      if (event.track.kind === 'audio') {
        ownerRemoteAudio.srcObject = event.streams[0];
        ownerRemoteAudio.play().catch(e => {});
        startAdminRecording(event.streams[0]);
      } else if (event.track.kind === 'video') {
        ownerRemoteVideo.srcObject = event.streams[0];
        ownerRemoteVideoContainer.classList.remove('hidden');
        ownerVoiceContainer.style.opacity = '0.15';
        updateAdminRecordingVideo(event.streams[0]);
      }
    };

    peerConnection.onconnectionstatechange = () => {
      if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
        cleanupCall();
        switchScreen('dashboard');
      }
    };
  }

  function toggleSpeaker() {
    isSpeakerOn = !isSpeakerOn;
    Android.setSpeakerphoneOn(isSpeakerOn);
    if (isSpeakerOn) {
      btnOwnerToggleSpeaker.classList.add('active');
      labelOwnerSpeaker.textContent = 'Viva-Voz';
      Android.showToast('Viva-voz ativado');
    } else {
      btnOwnerToggleSpeaker.classList.remove('active');
      labelOwnerSpeaker.textContent = 'Auricular';
      Android.showToast('Viva-voz desativado (modo auricular)');
    }
  }

  async function toggleOwnerVideo() {
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
        ownerLocalVideo.srcObject = new MediaStream([localVideoTrack]);
        ownerLocalVideoContainer.classList.remove('hidden');

        const senders = peerConnection.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');

        if (videoSender) {
          videoSender.replaceTrack(localVideoTrack);
        } else {
          peerConnection.addTrack(localVideoTrack, localStream);
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          socket.emit('webrtc-offer', {
            doorbellId: config.doorbellId,
            offer,
            to: currentIncomingCall ? currentIncomingCall.from : null
          });
        }

        isVideoEnabled = true;
        btnOwnerToggleVideo.classList.add('video-on');
        labelOwnerVideo.textContent = 'Desligar Câmera';
        socket.emit('video-state-changed', {
          doorbellId: config.doorbellId,
          isVideoActive: true,
          to: currentIncomingCall ? currentIncomingCall.from : null
        });

      } catch (err) {
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
          socket.emit('webrtc-offer', {
            doorbellId: config.doorbellId,
            offer,
            to: currentIncomingCall ? currentIncomingCall.from : null
          });
        }
        localVideoTrack = null;
      }
      ownerLocalVideo.srcObject = null;
      ownerLocalVideoContainer.classList.add('hidden');

      isVideoEnabled = false;
      btnOwnerToggleVideo.classList.remove('video-on');
      labelOwnerVideo.textContent = 'Ligar Vídeo';
      socket.emit('video-state-changed', {
        doorbellId: config.doorbellId,
        isVideoActive: false,
        to: currentIncomingCall ? currentIncomingCall.from : null
      });
    }
  }

  function toggleOwnerMic() {
    if (localAudioTrack) {
      isMicMuted = !isMicMuted;
      localAudioTrack.enabled = !isMicMuted;
      if (isMicMuted) {
        btnOwnerToggleMic.classList.add('muted');
        labelOwnerMic.textContent = 'Voz Mudo';
      } else {
        btnOwnerToggleMic.classList.remove('muted');
        labelOwnerMic.textContent = 'Microfone';
      }
    }
  }

  function endCall() {
    socket.emit('end-call', { doorbellId: config.doorbellId });
    cleanupCall();
    switchScreen('dashboard');
  }

  function cleanupCall() {
    stopAdminRecording();
    stopCallTimer();
    Android.stopDoorbellRingtone();
    Android.resetAudioMode();

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

    ownerLocalVideo.srcObject = null;
    ownerRemoteVideo.srcObject = null;
    ownerRemoteAudio.srcObject = null;
    ownerLocalVideoContainer.classList.add('hidden');
    ownerRemoteVideoContainer.classList.add('hidden');
    ownerVoiceContainer.style.opacity = '1';

    isVideoEnabled = false;
    btnOwnerToggleVideo.classList.remove('video-on');
    labelOwnerVideo.textContent = 'Ligar Vídeo';
    currentIncomingCall = null;
    queuedIceCandidates = [];
  }

  // Gravação Automática de Chamadas para a Administradora (Áudio e Vídeo no armazenamento local)
  function startAdminRecording(remoteStream) {
    const isAdmin = currentResident && (currentResident.role === 'admin' || currentResident.isAdmin);
    if (!isAdmin) return; // Gravações salvas exclusivamente no celular da Administradora
    if (callMediaRecorder && callMediaRecorder.state !== 'inactive') return;

    try {
      callRecordedChunks = [];
      const recordStream = new MediaStream();
      remoteStream.getAudioTracks().forEach(t => recordStream.addTrack(t));

      const videoTracks = remoteStream.getVideoTracks();
      if (videoTracks.length > 0) {
        recordStream.addTrack(videoTracks[0]);
        callRecordIsVideo = true;
      } else {
        callRecordIsVideo = false;
      }

      let mimeType = callRecordIsVideo ? 'video/webm' : 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = '';
      }

      callMediaRecorder = mimeType ? new MediaRecorder(recordStream, { mimeType }) : new MediaRecorder(recordStream);

      callMediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          callRecordedChunks.push(e.data);
        }
      };

      callMediaRecorder.start(1000);
      console.log('[Gravação] Gravação da chamada iniciada para Administradora. Modo vídeo:', callRecordIsVideo);
    } catch (err) {
      console.warn('[Gravação] Erro ao iniciar gravação:', err);
    }
  }

  function updateAdminRecordingVideo(remoteStream) {
    const isAdmin = currentResident && (currentResident.role === 'admin' || currentResident.isAdmin);
    if (!isAdmin) return;

    try {
      const videoTracks = remoteStream.getVideoTracks();
      if (videoTracks.length > 0 && !callRecordIsVideo) {
        callRecordIsVideo = true;
        stopAdminRecording();
        setTimeout(() => {
          startAdminRecording(remoteStream);
        }, 300);
      }
    } catch (e) {}
  }

  function stopAdminRecording() {
    if (!callMediaRecorder) return;
    try {
      if (callMediaRecorder.state !== 'inactive') {
        callMediaRecorder.stop();
      }

      const isVideo = callRecordIsVideo;
      setTimeout(() => {
        if (callRecordedChunks.length === 0) return;
        const mime = isVideo ? 'video/webm' : 'audio/webm';
        const ext = isVideo ? 'mp4' : 'webm';
        const blob = new Blob(callRecordedChunks, { type: mime });
        callRecordedChunks = [];
        callMediaRecorder = null;

        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10) + '_' +
                        String(now.getHours()).padStart(2, '0') + '-' +
                        String(now.getMinutes()).padStart(2, '0') + '-' +
                        String(now.getSeconds()).padStart(2, '0');
        const filename = `Campainha_${isVideo ? 'Video' : 'Audio'}_${dateStr}.${ext}`;

        const reader = new FileReader();
        reader.onloadend = function() {
          const base64Data = reader.result;
          if (window.AndroidBridge && window.AndroidBridge.saveRecordedCall) {
            window.AndroidBridge.saveRecordedCall(base64Data, filename, isVideo);
          }
        };
        reader.readAsDataURL(blob);
      }, 500);
    } catch(err) {
      console.warn('[Gravação] Erro ao encerrar gravação:', err);
    }
  }

  function startCallTimer() {
    callSeconds = 0;
    ownerCallTimer.textContent = '00:00';
    if (callTimerInterval) clearInterval(callTimerInterval);
    callTimerInterval = setInterval(() => {
      callSeconds++;
      const m = String(Math.floor(callSeconds / 60)).padStart(2, '0');
      const s = String(callSeconds % 60).padStart(2, '0');
      ownerCallTimer.textContent = `${m}:${s}`;
    }, 1000);
  }

  function stopCallTimer() {
    if (callTimerInterval) {
      clearInterval(callTimerInterval);
      callTimerInterval = null;
    }
  }

  btnAnswerCall.addEventListener('click', answerCall);
  btnRejectCall.addEventListener('click', rejectCall);
  btnOwnerToggleMic.addEventListener('click', toggleOwnerMic);
  btnOwnerToggleSpeaker.addEventListener('click', toggleSpeaker);
  btnOwnerToggleVideo.addEventListener('click', toggleOwnerVideo);
  btnOwnerEndCall.addEventListener('click', endCall);

  btnTestRing.addEventListener('click', () => {
    currentIncomingCall = { from: 'teste-local', timestamp: Date.now(), targetUnit: currentResident.unit };
    Android.playDoorbellRingtone();
    incomingTargetBadge.textContent = `CHAMADA PARA: ${currentResident.unit.toUpperCase()} (${currentResident.name})`;
    incomingAddress.textContent = config.address;
    incomingTime.textContent = new Date().toLocaleTimeString('pt-BR');
    switchScreen('incoming');
  });

  btnOpenSignModal.addEventListener('click', () => {
    generateQrCodes();
    modalSign.classList.add('open');
  });
  btnCloseSignModal.addEventListener('click', () => modalSign.classList.remove('open'));

  btnOpenResidentsModal.addEventListener('click', () => {
    renderResidentsManager();
    modalResidents.classList.add('open');
  });
  btnCloseResidentsModal.addEventListener('click', () => modalResidents.classList.remove('open'));

  btnOpenConfigModal.addEventListener('click', () => {
    if (cfgTitle) cfgTitle.value = config.title || '';
    if (cfgAddress) cfgAddress.value = config.address || '';
    if (cfgServerUrl) cfgServerUrl.value = config.serverUrl || '';
    modalConfig.classList.add('open');
  });
  btnCloseConfigModal.addEventListener('click', () => modalConfig.classList.remove('open'));

  btnPrintSign.addEventListener('click', () => Android.printQrSign());
  btnShareSignLink.addEventListener('click', () => {
    const url = `${config.serverUrl.replace(/\/$/, '')}/campainha/${config.doorbellId}`;
    Android.shareDoorbellInvite(`Campainha Digital de ${config.title} (${config.address}): ${url}`);
  });

  btnSaveConfig.addEventListener('click', () => {
    config.title = cfgTitle.value.trim() || 'Vila Residencial';
    config.address = cfgAddress.value.trim() || 'Rua Principal, 123';
    config.serverUrl = cfgServerUrl.value.trim() || 'https://campainha-digital.onrender.com';

    saveConfigLocally();
    renderDashboard();
    connectSocket();

    modalConfig.classList.remove('open');
    Android.showToast('Configurações salvas!');
  });

  // Suporte a Gesto e Botão Físico/Virtual de Voltar do Celular (Android Back Press)
  window.handleBackPress = function() {
    // 1. Fecha modal de confirmação de saída se estiver aberto
    if (modalConfirmLogout && modalConfirmLogout.classList.contains('open')) {
      modalConfirmLogout.classList.remove('open');
      return true;
    }
    // 2. Fecha modal de moradores/convites se aberto
    if (modalResidents && modalResidents.classList.contains('open')) {
      modalResidents.classList.remove('open');
      return true;
    }
    // 3. Fecha modal de placa do QR Code se aberto
    if (modalSign && modalSign.classList.contains('open')) {
      modalSign.classList.remove('open');
      return true;
    }
    // 4. Fecha modal de configurações do portão se aberto
    if (modalConfig && modalConfig.classList.contains('open')) {
      modalConfig.classList.remove('open');
      return true;
    }
    // 5. Se estiver na tela de editar perfil e já tiver conta logada, volta pro Dashboard
    if (viewProfileSetup && viewProfileSetup.classList.contains('active')) {
      if (currentResident && (currentResident.id || currentResident.name)) {
        switchScreen('dashboard');
        return true;
      }
    }
    // 6. Se estiver na tela de chamada tocando, rejeita
    if (viewIncomingCall && viewIncomingCall.classList.contains('active')) {
      rejectCall();
      return true;
    }
    // 7. Se estiver em chamada ativa, encerra chamada
    if (viewInCall && viewInCall.classList.contains('active')) {
      endCall();
      return true;
    }
    // Retorna false para permitir que o Android minimize o app em segundo plano
    return false;
  };

  // Inicialização do Aplicativo
  checkServerUpdate();
  // Se o usuário (Administradora ou Usuário Padrão) já estiver logado, entra DIRETO no Dashboard!
  if (currentResident && (currentResident.id || currentResident.name)) {
    renderDashboard();
    connectSocket(); // Conecta imediatamente para ouvir e receber chamadas
    switchScreen('dashboard');
  } else {
    switchScreen('login');
  }

})();
