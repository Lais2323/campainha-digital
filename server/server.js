const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const os = require('os');

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
const DATA_FILE = path.join(__dirname, 'doorbells.json');
const MASTER_ACCESS_CODE = '960499622@@';

// Carregar dados salvos das campainhas
let doorbells = {};
if (fs.existsSync(DATA_FILE)) {
  try {
    doorbells = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    console.error('Erro ao ler doorbells.json:', err);
    doorbells = {};
  }
}

function saveDoorbells() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(doorbells, null, 2), 'utf8');
  } catch (err) {
    console.error('Erro ao salvar doorbells.json:', err);
  }
}

// Retorna ou cria a campainha padrao se nao existir
function getOrCreateDoorbell(id) {
  if (!doorbells[id]) {
    doorbells[id] = {
      id: id,
      title: 'Vila / Condomínio Residencial',
      address: 'Rua Principal, 123',
      welcomeMessage: 'Selecione quem você deseja chamar:',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      // Lista de moradores / vizinhos / unidades cadastradas
      residents: [
        {
          id: 'admin_1',
          name: 'Carlos (Proprietário)',
          unit: 'Casa 1',
          photo: '',
          isAdmin: true,
          code: MASTER_ACCESS_CODE,
          createdAt: new Date().toISOString()
        }
      ]
    };
    saveDoorbells();
  }
  return doorbells[id];
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rota para obter os IPs da rede local
app.get('/api/network-info', (req, res) => {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  res.json({ ips: addresses, port: PORT });
});

// Validar código de autenticação
app.post('/api/auth/verify-code', (req, res) => {
  const { code, doorbellId } = req.body;
  const current = getOrCreateDoorbell(doorbellId || 'minha-casa');
  
  if (code === MASTER_ACCESS_CODE) {
    return res.json({ 
      success: true, 
      isAdmin: true, 
      message: 'Código de Administrador Mestre aceito!' 
    });
  }

  // Verifica se é código de um vizinho / morador adicionado
  const resident = current.residents.find(r => r.code === code);
  if (resident) {
    return res.json({ 
      success: true, 
      isAdmin: false, 
      resident: resident,
      message: 'Código de Morador aceito!' 
    });
  }

  return res.status(401).json({ 
    success: false, 
    message: 'Código incorreto. Digite o código de acesso válido.' 
  });
});

// Buscar detalhes e lista de moradores da campainha
app.get('/api/doorbell/:id', (req, res) => {
  const id = req.params.id || 'minha-casa';
  const data = getOrCreateDoorbell(id);
  res.json(data);
});

// Atualizar dados gerais (Nome, Endereço)
app.post('/api/doorbell/:id', (req, res) => {
  const id = req.params.id || 'minha-casa';
  const current = getOrCreateDoorbell(id);
  
  if (req.body.title !== undefined) current.title = req.body.title;
  if (req.body.address !== undefined) current.address = req.body.address;
  current.updatedAt = new Date().toISOString();
  saveDoorbells();
  
  io.to(`doorbell:${id}`).emit('config-updated', current);
  res.json({ success: true, data: current });
});

// Adicionar ou Atualizar Morador / Vizinho
app.post('/api/doorbell/:id/residents', (req, res) => {
  const id = req.params.id || 'minha-casa';
  const { resident, adminCode } = req.body;
  const current = getOrCreateDoorbell(id);

  if (adminCode !== MASTER_ACCESS_CODE) {
    return res.status(403).json({ error: 'Apenas o Administrador Mestre pode gerenciar moradores.' });
  }

  if (!resident || !resident.name || !resident.unit) {
    return res.status(400).json({ error: 'Nome e Casa/Unidade são obrigatórios.' });
  }

  const existingIdx = current.residents.findIndex(r => r.id === resident.id);
  if (existingIdx >= 0) {
    current.residents[existingIdx] = { ...current.residents[existingIdx], ...resident };
  } else {
    current.residents.push({
      id: resident.id || 'res_' + Date.now(),
      name: resident.name,
      unit: resident.unit,
      photo: resident.photo || '',
      isAdmin: false,
      code: resident.code || MASTER_ACCESS_CODE,
      createdAt: new Date().toISOString()
    });
  }

  current.updatedAt = new Date().toISOString();
  saveDoorbells();

  io.to(`doorbell:${id}`).emit('residents-updated', current.residents);
  res.json({ success: true, residents: current.residents });
});

// Excluir Morador (EXCLUSIVO PARA O ADMINISTRADOR MESTRE)
app.post('/api/doorbell/:id/residents/delete', (req, res) => {
  const id = req.params.id || 'minha-casa';
  const { residentId, adminCode } = req.body;
  const current = getOrCreateDoorbell(id);

  if (adminCode !== MASTER_ACCESS_CODE) {
    return res.status(403).json({ error: 'Apenas o Administrador Mestre pode remover moradores.' });
  }

  current.residents = current.residents.filter(r => r.id !== residentId);
  current.updatedAt = new Date().toISOString();
  saveDoorbells();

  // Desconecta o morador expulso
  io.to(`doorbell:${id}`).emit('resident-removed', { residentId });
  io.to(`doorbell:${id}`).emit('residents-updated', current.residents);
  
  res.json({ success: true, residents: current.residents });
});

// Rota de Download do APK Android direto no celular
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
    versionName: '2.0.0',
    versionCode: 2,
    downloadUrl: '/download',
    changelog: 'Suporte a vizinhos, autenticação por código seguro, foto de perfil, viva-voz e atualizador direto no app'
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
    res.status(500).send('Erro ao gerar QR Code');
  }
});

// Rota para o entregador acessar: /campainha/:id
app.get('/campainha/:id', (req, res, next) => {
  if (req.params.id && req.params.id.includes('.')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'visitor.html'));
});

// Rota raiz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Mapeamento de Moradores Conectados
// socketId -> { doorbellId, residentId, unit, name, role }
const connectedResidents = new Map();

io.on('connection', (socket) => {
  console.log(`[Socket Conectado] ${socket.id}`);

  // Registro de Morador / Vizinho autenticado pelo código
  socket.on('register-resident', ({ doorbellId, resident }) => {
    socket.doorbellId = doorbellId;
    socket.resident = resident;
    socket.role = 'resident';
    socket.join(`doorbell:${doorbellId}`);
    // Entra na sala específica da sua casa/unidade (Ex: unit:Casa 1)
    if (resident && resident.unit) {
      socket.join(`unit:${doorbellId}:${resident.unit}`);
    }

    connectedResidents.set(socket.id, {
      socketId: socket.id,
      doorbellId,
      residentId: resident.id,
      unit: resident.unit,
      name: resident.name,
      isAdmin: resident.isAdmin
    });

    const config = getOrCreateDoorbell(doorbellId);
    socket.emit('registered', { role: 'resident', config });
    console.log(`[Morador Registrado] ${resident.name} (${resident.unit}) | ID: ${doorbellId}`);
  });

  // Registro do Entregador/Visitante
  socket.on('register-visitor', ({ doorbellId }) => {
    socket.doorbellId = doorbellId;
    socket.role = 'visitor';
    socket.join(`doorbell:${doorbellId}`);
    
    const config = getOrCreateDoorbell(doorbellId);
    socket.emit('registered', { 
      role: 'visitor', 
      config,
      residents: config.residents || []
    });
    console.log(`[Visitante Conectado] Campainha: ${doorbellId}`);
  });

  // Entregador toca para um Morador/Unidade específico
  socket.on('ring-doorbell', ({ doorbellId, targetUnit, targetResidentId, visitorInfo }) => {
    console.log(`[🔔 CAMPAINHA TOCANDO] Destino: ${targetUnit || 'Geral'} em ${doorbellId}`);

    const callPayload = {
      from: socket.id,
      doorbellId,
      targetUnit,
      timestamp: Date.now(),
      visitorInfo: visitorInfo || {}
    };

    if (targetUnit) {
      // TOCA APENAS NO CELULAR DO MORADOR DAQUELA UNIDADE ESPECÍFICA!
      io.to(`unit:${doorbellId}:${targetUnit}`).emit('incoming-call', callPayload);
    } else {
      // Toca em todos
      socket.to(`doorbell:${doorbellId}`).emit('incoming-call', callPayload);
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
});
