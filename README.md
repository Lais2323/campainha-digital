# 🔔 Campainha Digital Residencial com QR Code, Voz e Vídeo

Sistema completo de **Campainha Inteligente para Portão** com aplicativo Android nativo (APK), página web para entregadores/visitantes sem necessidade de login, comunicação WebRTC em tempo real, suporte à autenticação com conta Google e toque simultâneo no seu celular e no da sua namorada.

---

## 📱 O Arquivo APK Pronto para Instalar

O APK compilado e pronto para uso está localizado na pasta:
👉 **`dist-apk/CampainhaDigital.apk`**

### Como instalar no celular (no seu e no da sua namorada):
1. Copie o arquivo `dist-apk/CampainhaDigital.apk` para os celulares (via WhatsApp, Telegram, Google Drive, e-mail ou cabo USB).
2. No celular, toque no arquivo `.apk` e selecione **Instalar** (permita "Instalar apps de fontes desconhecidas" caso o Android solicite).
3. Abra o app **Campainha Digital** e conceda as permissões de Microfone e Câmera.

---

## 🚀 Como Funciona o Sistema

```
   [ PLACA NO PORTÃO ] 
     (QR Code com Endereço e Nome)
             │
             │ Entregador / Visitante aponta a câmera
             ▼
   [ NAVEGADOR DO CELULAR DO ENTREGADOR ]
   - Não precisa de login nem instalar app
   - Exibe o Endereço e o Nome do Morador configurados
   - Botão grande: "TOCAR CAMPAINHA"
   - Inicia chamada SOMENTE POR VOZ (Microfone ativo, Câmera desligada)
   - Rodapé com botão: "ATIVAR VÍDEO" (caso necessário)
             │
             │ Dispara alerta em tempo real
             ▼
   [ SEU CELULAR ]  e  [ CELULAR DA NAMORADA ] (Simultâneo!)
   - Os celulares tocam e vibram como ligação telefônica
   - Mostra: "Entregador no Portão" + Endereço
   - Botões: Atender (Verde) e Recusar (Vermelho)
   - Quem atender primeiro estabelece a conversa
   - O outro aparelho para de tocar automaticamente
   - Inicia SOMENTE POR VOZ por padrão
   - Rodapé com botão: "LIGAR VÍDEO" (só transmite câmera se você ativar)
```

---

## 🔑 Principais Funcionalidades

### 1. Autenticação com Conta Google (Lado do Morador)
- Ao abrir o app, você e sua namorada fazem login com a conta Google.
- O nome da conta Google preenche automaticamente o perfil do morador.
- Segurança para que apenas os moradores autorizados tenham acesso ao painel e recebam as chamadas.

### 2. Celular da Namorada (Toque Duplo Simultâneo)
- No app, clique no botão **"Celular da Namorada"**.
- Mostra o **Código da Casa** (ex: `minha-casa`) e um QR Code de pareamento familiar.
- No celular dela: instale o mesmo APK, entre com o Google dela e sincronize com o código da casa.
- Quando o entregador tocar no portão, **os dois celulares tocam ao mesmo tempo**!
- Quem atender primeiro fala com o entregador, e o outro aparelho avisa que a chamada foi atendida.

### 3. Chamada por Voz Padrão + Vídeo Opcional no Rodapé
- **Visitante / Entregador**:
  - Inicia **sempre e apenas com áudio/voz**. A câmera dele começa desligada.
  - No rodapé da tela há o botão **"Ativar Vídeo"**: se ele ou você precisarem ver algo (um pacote, documento ou rosto), basta clicar para ligar a câmera.
- **Morador (App Android)**:
  - Ao atender, conecta **apenas com voz** (voz sempre ativa por padrão).
  - No rodapé da chamada há o botão **"Ligar Vídeo"**: sua câmera só é ativada se você clicar nele.

### 4. Configuração de Nome e Endereço
- No app, toque em **"Configurar Endereço"**:
  - **Nome do Morador / Família**: Ex: *Carlos & Ana* ou *Família Silva*.
  - **Endereço da Residência**: Ex: *Rua das Palmeiras, 123 - Casa 2*.
  - **Código da Campainha**: Identificador único da sua residência.
  - **URL do Servidor**: Endereço onde o servidor está rodando (local ou na nuvem).
- As informações salvas no app aparecem instantaneamente na tela do entregador ao escanear o QR Code.

### 5. Placa de QR Code Pronta para o Portão
- No app, toque em **"Placa do QR Code"**:
  - Gera automaticamente uma placa de alta resolução pronta para fixar no portão.
  - Contém o título **🔔 CAMPAINHA DIGITAL**, seu nome, endereço, o QR Code nítido e a instrução clara para entregadores.
  - Botão **"Imprimir Placa"**: imprime direto pelo Android.
  - Botão **"Compartilhar Link"**: para enviar o link do portão por mensagem.

---

## 🖥️ Como Iniciar o Servidor

O servidor gerencia a sinalização WebRTC de voz/vídeo e serve a página web do entregador.

### Opção A: Iniciar para Testes em Rede Wi-Fi Local
Dê um duplo clique no arquivo:
👉 **`INICIAR_SERVIDOR_LOCAL.bat`**
- O console mostrará o IP da sua rede (ex: `http://192.168.1.100:3000`).

### Opção B: Iniciar com Conexão Pública (4G/5G pela Internet)
Para que o entregador consiga escanear o QR Code usando os dados móveis (4G/5G) da operadora dele na rua:
Dê um duplo clique no arquivo:
👉 **`INICIAR_SERVIDOR_COM_INTERNET_4G.bat`**
- Cria automaticamente uma URL segura com **HTTPS (SSL)** (ex: `https://xxxx.loca.lt`).
- O HTTPS é fundamental para que os navegadores (Chrome, Safari do iPhone) liberem o uso do microfone e câmera do entregador.
- Basta colocar essa URL no campo **"URL do Servidor"** nas configurações do seu app Android.

---

## 📂 Estrutura dos Arquivos Criados

```
CAMPANHIA DIGITAL QR CODE/
├── dist-apk/
│   └── CampainhaDigital.apk      <-- APK NATIVO FINAL COMPILADO
├── server/
│   ├── server.js                 <-- Servidor Node.js + WebRTC + Multi-Moradores
│   ├── tunnel.js                 <-- Túnel seguro HTTPS para acesso 4G/5G
│   ├── package.json
│   └── public/
│       ├── visitor.html          <-- Interface do Entregador (Sem Login)
│       ├── visitor.js            <-- Lógica WebRTC, Voz padrão e botão de vídeo
│       ├── visitor.css           <-- Design responsivo moderno para celular
│       └── index.html            <-- Painel web do sistema
├── android/
│   ├── app/src/main/
│   │   ├── AndroidManifest.xml   <-- Permissões de Áudio, Câmera e Segundo Plano
│   │   ├── java/.../             <-- Código nativo Android (Toque sonoro, Vibração, Impressão)
│   │   └── assets/               <-- Interface do Morador (Google Login, Placa QR, Chamada)
│   └── build.gradle
├── INICIAR_SERVIDOR_LOCAL.bat
├── INICIAR_SERVIDOR_COM_INTERNET_4G.bat
├── INSTALAR_APK_NO_CELULAR.bat
└── README.md
```
