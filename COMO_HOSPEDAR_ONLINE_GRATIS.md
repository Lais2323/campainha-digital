# 🌐 Como Colocar sua Campainha Online 24h Grátis (Sem Abrir .BAT e Sem PC Ligado)

Para que sua campainha funcione **24 horas por dia**, de qualquer lugar do mundo pelo 4G/5G do entregador, sem que você precise deixar seu computador ligado ou abrir arquivos `.bat`, você pode hospedar o servidor em serviços de nuvem 100% gratuitos.

---

## 🥇 Opção 1: Render.com (Mais Recomendada - 100% Gratuita e Confiável)

O **[Render.com](https://render.com)** é uma plataforma de nuvem que permite rodar servidores Node.js e WebSockets com HTTPS automático e gratuito para sempre (sem pedir cartão de crédito).

### Passo a passo rápido (leva menos de 3 minutos):

1. **Crie uma conta gratuita**:
   - Acesse **[render.com](https://render.com)** e crie sua conta (pode entrar direto com sua conta Google ou GitHub).

2. **Crie o serviço na nuvem**:
   - No painel do Render, clique no botão azul **New +** e escolha **Web Service**.
   - Conecte sua conta do GitHub ou suba este projeto.
     *(Se preferir, crie um repositório no seu GitHub com a pasta `server` e selecione-o no Render)*.

3. **Configure as opções básicas no formulário**:
   - **Name**: `minha-campainha-residencial` (ou o nome que preferir).
   - **Language / Environment**: `Node`.
   - **Build Command**: `cd server && npm install` (ou apenas `npm install`).
   - **Start Command**: `cd server && node server.js` (ou `node server.js`).
   - **Instance Type**: Escolha **Free ($0/month)**.

4. **Clique em "Deploy Web Service"**:
   - O Render vai inicializar o servidor em cerca de 1 minuto.
   - No topo da tela, você verá a sua URL segura oficial com cadeado HTTPS, por exemplo:
     👉 **`https://minha-campainha-residencial.onrender.com`**

5. **Coloque a URL no seu App Android**:
   - Abra o app no seu celular.
   - Vá em **"Configurar Endereço"**.
   - No campo **"URL do Servidor na Nuvem"**, cole o seu link:
     `https://minha-campainha-residencial.onrender.com`
   - Toque em **"Testar Conexão com Servidor"** (vai aparecer: *✅ Servidor Online & Conectado!*).
   - Toque em **"Salvar Configurações"**.

> **Pronto!** A partir desse momento, a placa do QR Code do seu portão apontará diretamente para a nuvem. Entregadores podem escanear na rua pelo 4G/5G e você e sua namorada receberão a chamada em qualquer lugar, mesmo com seu computador desligado!

---

## 🥈 Opção 2: Glitch.com (Instantâneo em 30 Segundos, Sem GitHub)

Se você quiser colocar online agora sem precisar criar conta no GitHub:

1. Acesse **[glitch.com](https://glitch.com)** e clique em **Sign In** (entre com Google).
2. Clique em **New Project** -> **hello-node**.
3. No menu lateral do Glitch:
   - Abra o arquivo `package.json` e substitua pelo conteúdo de `server/package.json`.
   - Abra o `server.js` e substitua pelo conteúdo de `server/server.js`.
   - Crie a pasta `public` e cole os arquivos `visitor.html`, `visitor.js`, `visitor.css` e `index.html`.
4. O Glitch gera na hora um link público e gratuito com HTTPS:
   👉 **`https://seu-projeto.glitch.me`**
5. Coloque esse link no seu app Android em **"Configurar Endereço"** e salve!

---

## 📱 Por que a Nuvem é Essencial para Entregadores na Rua:

1. **Certificado SSL (HTTPS Obrigatório)**: Navegadores de celular (Google Chrome e Safari do iPhone) exigem conexão `https://` segura para liberar o acesso ao microfone e à câmera quando a pessoa não está no `localhost`.
2. **Independência do Computador**: Você não precisa deixar seu PC de casa ligado nem se preocupar com queda de energia no computador.
3. **Chamada em Qualquer Lugar**: Você e sua namorada podem estar no trabalho, no trânsito ou no supermercado e ainda assim atenderão o entregador no portão em tempo real.
