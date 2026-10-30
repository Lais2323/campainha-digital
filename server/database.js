// SISTEMA DE BANCO DE DADOS SQLite COM SUPORTE RBAC (CONTROLE DE ACESSO BASEADO EM CARGOS)
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'campainha.sqlite');
const FALLBACK_JSON = path.join(__dirname, 'campainha_db.json');
const MASTER_ADMIN_CODE = '960499622@@';

let db = null;
let isNativeSqlite = false;

// 1. Tenta inicializar SQLite nativo (Node 22+)
try {
  const { DatabaseSync } = require('node:sqlite');
  db = new DatabaseSync(DB_PATH);
  isNativeSqlite = true;
  console.log(`[SQLite] Banco de dados conectado com sucesso em: ${DB_PATH}`);
} catch (err) {
  console.log('[SQLite Fallback] node:sqlite não disponível, usando persistência relacional JSON segura.');
  isNativeSqlite = false;
}

// Inicialização das tabelas no SQLite nativo
if (isNativeSqlite) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      photo TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      access_code TEXT NOT NULL,
      created_at TEXT NOT NULL,
      invited_by TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      unit TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      expires_at TEXT DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS doorbell_config (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      address TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Garante que o usuário da Administradora exista
  const checkAdmin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!checkAdmin) {
    db.prepare(`
      INSERT INTO users (id, email, name, unit, photo, role, access_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'usr_admin_1',
      'admin@campainha.com',
      'Administradora',
      'Casa 1',
      '',
      'admin',
      MASTER_ADMIN_CODE,
      new Date().toISOString()
    );
    console.log('[SQLite] Administradora inicializada com sucesso.');
  }

  // Garante configuração padrão da campainha
  const checkConfig = db.prepare("SELECT * FROM doorbell_config WHERE id = 'minha-casa' LIMIT 1").get();
  if (!checkConfig) {
    db.prepare(`
      INSERT INTO doorbell_config (id, title, address, updated_at)
      VALUES (?, ?, ?, ?)
    `).run('minha-casa', 'Vila / Condomínio Residencial', 'Rua Principal, 123', new Date().toISOString());
  }
}

// Fallback JSON com a mesma interface relacional se node:sqlite não estiver disponível
let fallbackData = { users: [], invites: [], doorbell_config: [] };
if (!isNativeSqlite) {
  if (fs.existsSync(FALLBACK_JSON)) {
    try {
      fallbackData = JSON.parse(fs.readFileSync(FALLBACK_JSON, 'utf8'));
    } catch (e) {
      fallbackData = { users: [], invites: [], doorbell_config: [] };
    }
  }
  if (!fallbackData.users.some(u => u.role === 'admin')) {
    fallbackData.users.push({
      id: 'usr_admin_1',
      email: 'admin@campainha.com',
      name: 'Administradora',
      unit: 'Casa 1',
      photo: '',
      role: 'admin',
      access_code: MASTER_ADMIN_CODE,
      created_at: new Date().toISOString()
    });
  }
  if (!fallbackData.doorbell_config.some(c => c.id === 'minha-casa')) {
    fallbackData.doorbell_config.push({
      id: 'minha-casa',
      title: 'Vila / Condomínio Residencial',
      address: 'Rua Principal, 123',
      updated_at: new Date().toISOString()
    });
  }
  saveFallback();
}

function saveFallback() {
  if (!isNativeSqlite) {
    try {
      fs.writeFileSync(FALLBACK_JSON, JSON.stringify(fallbackData, null, 2), 'utf8');
    } catch (err) {
      console.error('Erro ao salvar fallback JSON:', err);
    }
  }
}

// OPERAÇÕES DO BANCO DE DADOS COM RBAC
const Database = {
  // Autenticação por código (Master Admin ou Código do Usuário/Convidado)
  findUserByCode(code) {
    if (!code) return null;
    const cleanCode = code.trim();
    if (isNativeSqlite) {
      return db.prepare("SELECT * FROM users WHERE access_code = ?").get(cleanCode) || null;
    } else {
      return fallbackData.users.find(u => u.access_code === cleanCode) || null;
    }
  },

  findUserById(id) {
    if (isNativeSqlite) {
      return db.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
    } else {
      return fallbackData.users.find(u => u.id === id) || null;
    }
  },

  findUserByEmail(email) {
    if (!email) return null;
    const cleanEmail = email.trim().toLowerCase();
    if (isNativeSqlite) {
      return db.prepare("SELECT * FROM users WHERE lower(email) = ?").get(cleanEmail) || null;
    } else {
      return fallbackData.users.find(u => u.email && u.email.toLowerCase() === cleanEmail) || null;
    }
  },

  // Lista todos os usuários (apenas Administrador pode acessar)
  getAllUsers() {
    if (isNativeSqlite) {
      return db.prepare("SELECT id, email, name, unit, photo, role, created_at, invited_by FROM users ORDER BY role DESC, created_at ASC").all();
    } else {
      return fallbackData.users.map(({ access_code, ...u }) => u);
    }
  },

  // Criar Usuário (ou atualizar)
  saveUser(user) {
    if (isNativeSqlite) {
      const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
      if (existing) {
        db.prepare(`
          UPDATE users SET 
            name = ?, 
            unit = ?, 
            photo = ?, 
            email = COALESCE(?, email),
            role = COALESCE(?, role)
          WHERE id = ?
        `).run(user.name, user.unit, user.photo || '', user.email || null, user.role || null, user.id);
      } else {
        db.prepare(`
          INSERT INTO users (id, email, name, unit, photo, role, access_code, created_at, invited_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          user.id,
          user.email || null,
          user.name,
          user.unit,
          user.photo || '',
          user.role || 'user',
          user.access_code,
          user.created_at || new Date().toISOString(),
          user.invited_by || null
        );
      }
    } else {
      const idx = fallbackData.users.findIndex(u => u.id === user.id);
      if (idx >= 0) {
        fallbackData.users[idx] = { ...fallbackData.users[idx], ...user };
      } else {
        fallbackData.users.push(user);
      }
      saveFallback();
    }
    return this.findUserById(user.id);
  },

  // Remover usuário (Protegido: NUNCA permite remover o Admin mestre)
  deleteUser(userId) {
    const user = this.findUserById(userId);
    if (!user) return { success: false, error: 'Usuário não encontrado' };
    if (user.role === 'admin') {
      return { success: false, error: 'Não é permitido remover a Administradora do sistema.' };
    }

    if (isNativeSqlite) {
      db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    } else {
      fallbackData.users = fallbackData.users.filter(u => u.id !== userId);
      saveFallback();
    }
    return { success: true };
  },

  // ==================== SISTEMA DE CONVITES RBAC ====================
  // Administradora convida novo usuário digitando o e-mail
  createInvite({ email, unit, invitedBy }) {
    const cleanEmail = email.trim().toLowerCase();
    
    // Verifica se já existe um usuário ativo com este e-mail
    const existingUser = this.findUserByEmail(cleanEmail);
    if (existingUser) {
      return { success: false, error: 'Já existe um usuário cadastrado com este e-mail.' };
    }

    // Gera código único de convite amigável (Ex: CONV-7492)
    const randomDigits = Math.floor(1000 + Math.random() * 9000);
    const inviteCode = `CONV-${randomDigits}`;
    const inviteId = 'inv_' + Date.now();
    const createdAt = new Date().toISOString();

    const invite = {
      id: inviteId,
      email: cleanEmail,
      code: inviteCode,
      unit: unit || 'Casa 1',
      role: 'user', // SEMPRE associado como Usuário Padrão
      status: 'pending',
      created_at: createdAt
    };

    if (isNativeSqlite) {
      // Remove convites pendentes anteriores para o mesmo e-mail
      db.prepare("DELETE FROM invites WHERE lower(email) = ? AND status = 'pending'").run(cleanEmail);
      db.prepare(`
        INSERT INTO invites (id, email, code, unit, role, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(invite.id, invite.email, invite.code, invite.unit, invite.role, invite.status, invite.created_at);
    } else {
      fallbackData.invites = fallbackData.invites.filter(i => !(i.email.toLowerCase() === cleanEmail && i.status === 'pending'));
      fallbackData.invites.push(invite);
      saveFallback();
    }

    console.log(`[RBAC] Convite gerado para ${cleanEmail} com código ${inviteCode} (Role: Usuário Padrão)`);
    return { success: true, invite };
  },

  getInviteByCode(code) {
    if (!code) return null;
    const cleanCode = code.trim().toUpperCase();
    if (isNativeSqlite) {
      return db.prepare("SELECT * FROM invites WHERE upper(code) = ? AND status = 'pending'").get(cleanCode) || null;
    } else {
      return fallbackData.invites.find(i => i.code.toUpperCase() === cleanCode && i.status === 'pending') || null;
    }
  },

  getAllInvites() {
    if (isNativeSqlite) {
      return db.prepare("SELECT * FROM invites ORDER BY created_at DESC").all();
    } else {
      return [...fallbackData.invites].reverse();
    }
  },

  deleteInvite(inviteId) {
    if (isNativeSqlite) {
      db.prepare("DELETE FROM invites WHERE id = ?").run(inviteId);
    } else {
      fallbackData.invites = fallbackData.invites.filter(i => i.id !== inviteId);
      saveFallback();
    }
    return { success: true };
  },

  // Aceitar convite e transformar em Usuário Padrão
  acceptInvite(code, { name, photo }) {
    const invite = this.getInviteByCode(code);
    if (!invite) {
      return { success: false, error: 'Convite inválido ou expirado.' };
    }

    const newUser = {
      id: 'usr_' + Date.now(),
      email: invite.email,
      name: name || 'Convidado',
      unit: invite.unit,
      photo: photo || '',
      role: 'user', // Garantido como Usuário Padrão (RBAC)
      access_code: invite.code, // Pode continuar acessando pelo mesmo código do convite
      created_at: new Date().toISOString(),
      invited_by: 'Administradora'
    };

    this.saveUser(newUser);

    // Marca o convite como aceito
    if (isNativeSqlite) {
      db.prepare("UPDATE invites SET status = 'accepted' WHERE id = ?").run(invite.id);
    } else {
      const inv = fallbackData.invites.find(i => i.id === invite.id);
      if (inv) inv.status = 'accepted';
      saveFallback();
    }

    return { success: true, user: newUser };
  },

  // Configuração da Campainha
  getDoorbellConfig(doorbellId = 'minha-casa') {
    if (isNativeSqlite) {
      return db.prepare("SELECT * FROM doorbell_config WHERE id = ?").get(doorbellId) || {
        id: doorbellId,
        title: 'Vila / Condomínio Residencial',
        address: 'Rua Principal, 123',
        updated_at: new Date().toISOString()
      };
    } else {
      return fallbackData.doorbell_config.find(c => c.id === doorbellId) || {
        id: doorbellId,
        title: 'Vila / Condomínio Residencial',
        address: 'Rua Principal, 123',
        updated_at: new Date().toISOString()
      };
    }
  },

  saveDoorbellConfig(config) {
    const updatedAt = new Date().toISOString();
    if (isNativeSqlite) {
      db.prepare(`
        INSERT INTO doorbell_config (id, title, address, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET title = excluded.title, address = excluded.address, updated_at = excluded.updated_at
      `).run(config.id || 'minha-casa', config.title, config.address, updatedAt);
    } else {
      const idx = fallbackData.doorbell_config.findIndex(c => c.id === (config.id || 'minha-casa'));
      if (idx >= 0) {
        fallbackData.doorbell_config[idx] = { ...fallbackData.doorbell_config[idx], ...config, updated_at: updatedAt };
      } else {
        fallbackData.doorbell_config.push({ ...config, updated_at: updatedAt });
      }
      saveFallback();
    }
    return this.getDoorbellConfig(config.id);
  }
};

module.exports = Database;
