const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const os = require('os');
const Database = require('./database');

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;
const MASTER_ACCESS_CODE = '960499622@@';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Descobrir IPs locais para depuração
app.get('/api/network', (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const k in interfaces) {
    for (const k2 in interfaces[k]) {
      const address = interfaces[k][k2];
      if (address.family === 'IPv4' && !address.internal) {
        addresses.push(address.address);
      }
    }
  }
  res.json({ ips: addresses, port: PORT });
});

// ==================== ROTAS DE AUTENTICAÇÃO E RBAC ====================

// 1. Verificação de Código de Acesso (Administradora, Usuário ou Convite)
app.post('/api/auth/verify-code', (req, res) => {
  const { code } = req.body;
  if (!code) {
    return res.status(400).json({ success: false, error: 'Código de acesso não fornecido.' });
  }

  const cleanCode = code.trim();

  // Verifica se é a Administradora (pelo código mestre)
  if (cleanCode === MASTER_ACCESS_CODE) {
    const adminUser = Database.findUserByCode(MASTER_ACCESS_CODE);
    return res.json({
      success: true,
      type: 'user',
      role: 'admin',
      user: adminUser
    });
  }

  // Verifica se é um usuário já existente no banco de dados SQLite
  const existingUser = Database.findUserByCode(cleanCode);
  if (existingUser) {
    return res.json({
      success: true,
      type: 'user',
      role: existingUser.role, // 'admin' ou 'user'
      user: existingUser
    });
  }

  // Verifica se é um convite pendente para Usuário Padrão
  const invite = Database.getInviteByCode(cleanCode);
  if (invite) {
    return res.json({
      success: true,
      type: 'invite',
      role: 'user', // Sempre Usuário Padrão por regra RBAC
      invite: {
        id: invite.id,
        email: invite.email,
        unit: invite.unit,
        code: invite.code,
        role: 'user'
      }
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Código de acesso incorreto ou convite inexistente.'
  });
});

// 2. Cadastro / Aceite de Convite (Cadastra o usuário como "Usuário Padrão")
app.post('/api/auth/register-invite', (req, res) => {
  const { code, name, photo } = req.body;
  if (!code || !name) {
    return res.status(400).json({ success: false, error: 'Código do convite e nome são obrigatórios.' });
  }

  const result = Database.acceptInvite(code, { name, photo });
  if (!result.success) {
    return res.status(400).json(result);
  }

  // Atualiza em tempo real a lista de moradores nos celulares e na tela do portão
  io.to('doorbell:minha-casa').emit('residents-updated', Database.getAllUsers());

  res.json({
    success: true,
    user: result.user
  });
});

// ==================== ROTAS ADMINISTRATIVAS (RBAC: ADMIN ONLY) ====================

// 3. Convidar Novo Usuário (Apenas Administradora)
app.post('/api/admin/invite', (req, res) => {
  const { email, unit, adminCode } = req.body;

  // Validação de Permissão RBAC
  if (adminCode !== MASTER_ACCESS_CODE) {
    return res.status(403).json({
      success: false,
      error: 'Acesso negado. Apenas a Administradora possui permissão para convidar novos usuários.'
    });
  }

  if (!email || !email.includes('@')) {
    return res.status(400).json({ success: false, error: 'Por favor, informe um endereço de e-mail válido.' });
  }

  const result = Database.createInvite({
    email,
    unit: unit || 'Casa 1',
    invitedBy: 'Administradora'
  });

  if (!result.success) {
    return res.status(400).json(result);
  }

  res.json(result);
});

// 4. Listar Usuários e Convites com Códigos de Acesso (Apenas Administradora)
app.get('/api/admin/users', (req, res) => {
  const adminCode = req.query.adminCode || req.headers['x-admin-code'];
  if (adminCode !== MASTER_ACCESS_CODE) {
    return res.status(403).json({
      success: false,
      error: 'Acesso negado. Painel administrativo restrito à Administradora.'
    });
  }

  res.json({
    success: true,
    users: Database.getAllUsers(true), // Envia os códigos de acesso dos moradores para a Administradora
    invites: Database.getAllInvites()
  });
});

// 4.1 Personalizar Código de Acesso do Morador (Apenas Administradora)
app.post('/api/admin/users/:id/code', (req, res) => {
  const adminCode = req.body.adminCode || req.headers['x-admin-code'];
  if (adminCode !== MASTER_ACCESS_CODE) {
    return res.status(403).json({
      success: false,
      error: 'Acesso negado. Apenas a Administradora pode alterar os códigos de acesso.'
    });
  }

  const { newCode } = req.body;
  const result = Database.updateUserAccessCode(req.params.id, newCode);
  if (!result.success) {
    return res.status(400).json(result);
  }

  // Notifica os moradores conectados
  io.to('doorbell:minha-casa').emit('residents-updated', Database.getAllUsers(false));
  res.json(result);
});

// 5. Excluir Usuário (Apenas Administradora - protegido contra exclusão da própria admin)
app.delete('/api/admin/users/:id', (req, res) => {
  const adminCode = req.body.adminCode || req.headers['x-admin-code'];
  if (adminCode !== MASTER_ACCESS_CODE) {
    return res.status(403).json({ success: false, error: 'Acesso negado. Apenas a Administradora pode remover usuários.' });
  }

  const result = Database.deleteUser(req.params.id);
  if (!result.success) {
    return res.status(400).json(result);
  }

  io.to('doorbell:minha-casa').emit('resident-removed', { residentId: req.params.id });
  io.to('doorbell:minha-casa').emit('residents-updated', Database.getAllUsers());
  res.json({ success: true, message: 'Usuário removido com sucesso.' });
});

// 6. Cancelar Convite Pendente
app.delete('/api/admin/invites/:id', (req, res) => {
  const adminCode = req.body.adminCode || req.headers['x-admin-code'];
  if (adminCode !== MASTER_ACCESS_CODE) {
    return res.status(403).json({ success: false, error: 'Acesso negado.' });
  }

  const result = Database.deleteInvite(req.params.id);
  res.json(result);
});

// ==================== ROTAS DA CAMPAINHA E PORTÃO ====================

// Buscar detalhes da campainha e lista de moradores cadastrados
app.get('/api/doorbell/:id', (req, res) => {
  const id = req.params.id || 'minha-casa';
  const cfg = Database.getDoorbellConfig(id);
  const residents = Database.getAllUsers();
  res.json({
    ...cfg,
    residents
  });
});

// Atualizar título/endereço da campainha (Apenas Administradora)
app.post('/api/doorbell/:id', (req, res) => {
  const id = req.params.id || 'minha-casa';
  const { title, address, adminCode } = req.body;

  if (adminCode !== MASTER_ACCESS_CODE) {
    return res.status(403).json({ success: false, error: 'Apenas a Administradora pode alterar as configurações do sistema.' });
  }

  const updated = Database.saveDoorbellConfig({ id, title, address });
  io.to(`doorbell:${id}`).emit('config-updated', updated);
  res.json({ success: true, data: updated });
});

// Compatibilidade: Adicionar ou Atualizar Morador
app.post('/api/doorbell/:id/residents', (req, res) => {
  const { resident, adminCode } = req.body;
  if (adminCode !== MASTER_ACCESS_CODE) {
    return res.status(403).json({ error: 'Apenas a Administradora pode gerenciar moradores.' });
  }

  if (!resident || !resident.name || !resident.unit) {
    return res.status(400).json({ error: 'Nome e Casa/Unidade são obrigatórios.' });
  }

  Database.saveUser({
    id: resident.id || 'usr_' + Date.now(),
    name: resident.name,
    unit: resident.unit,
    photo: resident.photo || '',
    role: resident.role || 'user',
    access_code: resident.code || 'CONV-' + Math.floor(1000 + Math.random() * 9000),
    email: resident.email || null
  });

  const updatedList = Database.getAllUsers();
  io.to('doorbell:minha-casa').emit('residents-updated', updatedList);
  res.json({ success: true, residents: updatedList });
});

// Atualização de Perfil pelo próprio Morador (Foto, Nome)
app.post('/api/user/profile', (req, res) => {
  const { id, name, unit, photo, code } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: 'ID e Nome são obrigatórios.' });
  }

  const existing = Database.findUserById(id) || Database.findUserByCode(code);
  if (!existing) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  const updatedUnit = (existing.role === 'admin') ? (unit || existing.unit) : existing.unit;
  const savedUser = Database.saveUser({
    id: existing.id,
    name: name.trim(),
    unit: updatedUnit,
    photo: (photo !== undefined && photo !== null) ? photo : existing.photo,
    role: existing.role,
    access_code: existing.access_code || code,
    email: existing.email
  });

  const all = Database.getAllUsers();
  io.to('doorbell:minha-casa').emit('residents-updated', all);
  res.json({ success: true, user: savedUser });
});

// Compatibilidade: Excluir Morador
app.post('/api/doorbell/:id/residents/delete', (req, res) => {
  const { residentId, adminCode } = req.body;
  if (adminCode !== MASTER_ACCESS_CODE) {
    return res.status(403).json({ error: 'Apenas a Administradora pode remover moradores.' });
  }

  const result = Database.deleteUser(residentId);
  if (!result.success) {
    return res.status(400).json(result);
  }

  io.to('doorbell:minha-casa').emit('resident-removed', { residentId });
  io.to('doorbell:minha-casa').emit('residents-updated', Database.getAllUsers());
  res.json({ success: true, residents: Database.getAllUsers() });
});

// Download do APK Android direto no celular
app.get('/download', (req, res) => {
  const apkPath = path.join(__dirname, 'public', 'CampainhaDigital.apk');
  if (fs.existsSync(apkPath)) {
    res.download(apkPath, 'CampainhaDigital.apk');
  } else {
    res.status(404).send('APK ainda não disponível para download.');
  }
});

// Verificação de versão atualizada
app.get('/api/version', (req, res) => {
  res.json({
    versionName: '2.6.0',
    versionCode: 8,
    downloadUrl: '/download',
    changelog: 'Controles de mídia para entregador (microfone, viva-voz, câmera, encerrar) e morador iniciando com áudio e viva-voz'
  });
});

// Gerar QR Code para o visitante (placa do portão)
app.get('/api/qr/:id', async (req, res) => {
  try {
    const id = req.params.id || 'minha-casa';
    const host = req.get('host');
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const url = `${protocol}://${host}/campainha/${id}`;
    
    const qrBuffer = await QRCode.toBuffer(url, {
      width: 600,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
    
    res.type('png');
    res.send(qrBuffer);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao gerar QR Code' });
  }
});

// Rota para o entregador / visitante acessar
app.get(['/campainha', '/campainha/:id', '/visitor', '/visitante'], (req, res, next) => {
  if (req.params.id && req.params.id.includes('.')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'visitor.html'));
});

// Rota raiz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== COMUNICAÇÃO EM TEMPO REAL (SOCKET.IO) ====================

const connectedResidents = new Map();

io.on('connection', (socket) => {
  console.log(`[Socket Conectado] ${socket.id}`);

  // Registro de Morador / Administradora autenticado
  socket.on('register-resident', ({ doorbellId, resident }) => {
    doorbellId = doorbellId || 'minha-casa';
    socket.doorbellId = doorbellId;
    socket.resident = resident;
    socket.role = (resident && resident.role) ? resident.role : 'user';
    socket.join(`doorbell:${doorbellId}`);

    if (resident && resident.unit) {
      socket.join(`unit:${doorbellId}:${resident.unit}`);
      socket.join(`unit:${doorbellId}:${resident.unit.trim()}`);
      socket.join(`unit:${doorbellId}:${resident.unit.trim().toLowerCase()}`);
    }

    connectedResidents.set(socket.id, {
      socketId: socket.id,
      doorbellId,
      residentId: resident ? resident.id : null,
      unit: resident ? resident.unit : null,
      name: resident ? resident.name : null,
      role: socket.role,
      isAdmin: socket.role === 'admin'
    });

    const config = Database.getDoorbellConfig(doorbellId);
    const residents = Database.getAllUsers(socket.role === 'admin');
    socket.emit('registered', { role: 'resident', config: { ...config, residents }, residents });
    console.log(`[Morador Registrado] ${resident ? resident.name : 'Anônimo'} (${resident ? resident.unit : 'Geral'}) [Cargo: ${socket.role}] | ID: ${doorbellId}`);
  });

  // Registro do Entregador/Visitante
  socket.on('register-visitor', ({ doorbellId }) => {
    doorbellId = doorbellId || 'minha-casa';
    socket.doorbellId = doorbellId;
    socket.role = 'visitor';
    socket.join(`doorbell:${doorbellId}`);
    
    const config = Database.getDoorbellConfig(doorbellId);
    const residents = Database.getAllUsers();
    socket.emit('registered', { 
      role: 'visitor', 
      config: { ...config, residents },
      residents
    });
    console.log(`[Visitante Conectado] Campainha: ${doorbellId}`);
  });

  // Entregador toca para um Morador/Unidade específico
  socket.on('ring-doorbell', ({ doorbellId, targetUnit, targetResidentId, visitorInfo }) => {
    doorbellId = doorbellId || 'minha-casa';
    console.log(`[🔔 CAMPAINHA TOCANDO] Destino: ${targetUnit || 'Geral'} em ${doorbellId}`);

    const callPayload = {
      from: socket.id,
      doorbellId,
      targetUnit: targetUnit || null,
      targetResidentId: targetResidentId || null,
      timestamp: Date.now(),
      visitorInfo: visitorInfo || {}
    };

    // 1. SEMPRE envia para a sala geral da campainha para NUNCA perder chamada
    socket.to(`doorbell:${doorbellId}`).emit('incoming-call', callPayload);

    // 2. Se houver unidade específica, dispara também diretamente para as variações de sala da unidade
    if (targetUnit) {
      io.to(`unit:${doorbellId}:${targetUnit}`).emit('incoming-call', callPayload);
      io.to(`unit:${doorbellId}:${targetUnit.trim()}`).emit('incoming-call', callPayload);
      io.to(`unit:${doorbellId}:${targetUnit.trim().toLowerCase()}`).emit('incoming-call', callPayload);
    }

    socket.emit('ringing-started', { timestamp: Date.now() });
  });

  // Morador atende
  socket.on('answer-call', ({ doorbellId, targetVisitorId, residentInfo }) => {
    console.log(`[📞 CHAMADA ATENDIDA] Morador ${residentInfo ? residentInfo.name : socket.id} atendeu!`);
    
    if (targetVisitorId) {
      io.to(targetVisitorId).emit('call-answered', { 
        by: socket.id,
        resident: residentInfo || {}
      });
    }

    // Se houver mais de um aparelho na mesma unidade, para o toque nos outros
    if (socket.resident && socket.resident.unit) {
      socket.to(`unit:${doorbellId}:${socket.resident.unit}`).emit('call-answered-by-peer', {
        byName: socket.resident.name
      });
    }
  });

  // Recusar / Encerrar
  socket.on('reject-call', ({ doorbellId }) => {
    socket.to(`doorbell:${doorbellId}`).emit('call-rejected', { by: socket.id });
  });

  socket.on('end-call', ({ doorbellId }) => {
    socket.to(`doorbell:${doorbellId}`).emit('call-ended', { by: socket.id });
  });

  // WebRTC
  socket.on('webrtc-offer', ({ doorbellId, offer, to }) => {
    if (to) io.to(to).emit('webrtc-offer', { offer, from: socket.id });
  });

  socket.on('webrtc-answer', ({ doorbellId, answer, to }) => {
    if (to) io.to(to).emit('webrtc-answer', { answer, from: socket.id });
  });

  socket.on('webrtc-ice-candidate', ({ doorbellId, candidate, to }) => {
    if (to) io.to(to).emit('webrtc-ice-candidate', { candidate, from: socket.id });
  });

  socket.on('video-state-changed', ({ doorbellId, isVideoActive, to }) => {
    if (to) io.to(to).emit('remote-video-state-changed', { from: socket.id, isVideoActive });
  });

  socket.on('disconnect', () => {
    connectedResidents.delete(socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🔔 Servidor Campainha Digital rodando na porta ${PORT}`);
  console.log(`🛡️ Sistema RBAC e Banco de Dados SQLite Ativos!`);
});
