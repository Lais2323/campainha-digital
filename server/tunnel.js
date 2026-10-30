const localtunnel = require('localtunnel');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

(async () => {
  console.log('Criando túnel HTTPS público para acesso via 4G/5G...');
  try {
    const tunnel = await localtunnel({ port: PORT });
    console.log('========================================================');
    console.log('✅ TÚNEL PÚBLICO HTTPS CRIADO COM SUCESSO!');
    console.log(`🔗 Link Público HTTPS: ${tunnel.url}`);
    console.log(`🔔 Link do Entregador: ${tunnel.url}/campainha/minha-casa`);
    console.log('Este link possui certificado SSL (HTTPS) válido para a');
    console.log('câmera e microfone funcionarem em qualquer celular!');
    console.log('========================================================');

    tunnel.on('close', () => {
      console.log('Túnel fechado.');
    });
  } catch (err) {
    console.error('Erro ao abrir túnel:', err);
  }
})();
