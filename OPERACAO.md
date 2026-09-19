# Operação do Preditor FCU — manutenção de 19/09/2026

## Sites e fontes

| Site | URL | Fonte |
|---|---|---|
| Preditor FCU atual (original) | https://preditor-fcu-v2.vercel.app | `E:\Banco de dados Preditor Br\03_preditor_grade31_teste0407\03_outputs\05_dashboard_b_salvador_fcu_tipos_online` |
| Preditor LoginPercp | https://preditor-fcu-login.vercel.app | `C:\Users\adirs\.gemini\antigravity\scratch\preditor-fcu-login` |
| Master | https://preditor-fcu-master.vercel.app | `C:\Users\adirs\.gemini\antigravity\scratch\preditor-fcu-master` |

LoginPercp usa `adirson52/preditor-fcu-login`, branch `main`. A cópia `D:\preditor-fcu-login` é uma cópia de trabalho que deve acompanhar essa mesma branch; não publicar simultaneamente alterações diferentes das duas pastas.

O original usa `adirson52/preditor_three_models-`, branch **`dashboard-ranking-escada-20260828`**, não `main`. Seus 6.606 arquivos publicados foram comparados ao computador: conteúdo idêntico. O original não precisa ser reconstruído ou receber a interface autenticada.

Backups locais desta manutenção: `D:\preditor-maintenance-backups\2026-09-19`. Contêm material sensível e não devem ir para Git ou Vercel. O antigo `D:\preditor-fcu-login\api\signup.js` foi preservado como histórico, não deve ser reincorporado.

## Cadastro e recuperação

Cadastro automático pelo servidor da Master, senha mínima de seis caracteres, aceites explícitos e limite de tentativas por conexão. Não depende do SMTP; não comprova propriedade do e-mail. Erros não acionam um segundo caminho de cadastro direto no navegador.

**Esqueci minha senha** envia uma solicitação a **Master → Uso geral → Mensagens**. A equipe confirma a identidade e usa **Preditor LoginPercp → participantes → Senha** para definir a nova senha. O contato do pedido é não verificado. Nenhuma senha deve ser enviada dentro do pedido ou de mensagens abertas. Não existe envio automático de e-mail de recuperação nesse fluxo.

## Percepções e dispositivos

- A gravação no Supabase só é confirmada depois que o servidor devolve o registro correspondente.
- Rascunhos pendentes e revisões offline ficam separados por usuário neste navegador. Enquanto estiver pendente, o desenho ainda não estará disponível em outro dispositivo.
- A sincronização envia cada revisão salva em sequência. Os triggers existentes mantêm o histórico das geometrias e da pesquisa.
- Atualizações comparam a data da versão original; se outro dispositivo alterou a mesma percepção, não sobrescrevem silenciosamente a versão remota. A interface permite preservar a edição local como uma cópia separada.
- Ao retornar à janela, recuperar a conexão e periodicamente em primeiro plano, o cliente consulta atualizações.
- Os caches antigos permanecem preservados. Registros sem proprietário explícito não são atribuídos automaticamente a outra conta.
- Arquivar/restaurar percepção é reversível. A exclusão de contas pela Master também passa a ser reversível: suspende o acesso e move para a lixeira, preservando perfil, mensagens, percepções e revisões.

## Interface móvel e contas — complemento de 19/09/2026

- Até 1.024 px, a apresentação inicial é **Simplificado**: mapa, áreas de estudo e navegação inferior Mapa/Percepções/Conta. A escolha Simplificado/Completo fica salva neste navegador. O painel de percepções pode ser expandido ou recolhido sem encobrir todo o mapa.
- O indicador distingue **Neste aparelho**, **Enviando**, **Salvo online**, **Sem conexão** e conflitos. Um rascunho local não é backup: não limpar dados do navegador enquanto houver pendências. O mapa-base e o primeiro carregamento continuam dependendo da internet; não é um aplicativo offline completo.
- Os dados online são compartilhados pela mesma conta. Sessões do navegador interno do WhatsApp, Chrome e atalho instalado podem ter armazenamentos separados e exigir login próprio. Não foi implementada autenticação por digital/passkey.
- A Master administra Ativos/Suspensos/Lixeira e restaura contas. Se a conta estava suspensa antes de ir à lixeira, continua suspensa após restaurar.
- A migração `participant_account_lifecycle` acrescenta controles e auditoria privados e políticas restritivas nas cinco tabelas dos participantes. O estado é verificado no banco, não em metadados editáveis do usuário.
- Suspender, excluir, restaurar, reativar ou redefinir senha invalida o acesso de sessões anteriores aos dados protegidos. Restaurar/reativar exige novo login. O cliente verifica ao entrar, recuperar conexão, retornar à tela e a cada 45 segundos em primeiro plano. Isso não apaga cópias que já estavam salvas num aparelho offline.
- Sair encerra a sessão deste dispositivo, sem desconectar outros dispositivos ativos. Rascunhos locais continuam separados pelo proprietário.
- Recuperação continua manual pela equipe. A senha redefinida solicita troca no próximo acesso; confirmar a identidade por canal conhecido antes de entregar a senha temporária. O pedido público de recuperação não prova propriedade do e-mail.

## Rotina segura de publicação

1. `git status`: identificar e preservar alterações anteriores.
2. `npm test`: testes locais simulados. `npm run test:e2e` é a bateria de navegador separada.
3. Commitar apenas fontes/regras/testes/documentação, nunca `.env`, `.vercel`, backups ou credenciais.
4. Publicar candidato na Vercel, conferir arquivos e endpoints, e só então promover. O projeto LoginPercp também possui integração com GitHub; considerar o deploy automático de `main` antes de um push.
5. Comparar os arquivos servidos com os fontes e registrar o commit publicado.

## Validação e limites

A bateria autorizada usa contas sintéticas identificadas como QA técnico e sessões de navegador independentes contra o banco real. Foram exercitados criação, geometria idêntica em outra sessão, edição offline, reconexão, conflitos, lixeira de percepções, histórico e exportação. Testes móveis usam emulação de viewport/toque; não substituem o teste final em aparelhos físicos Android/iOS e no navegador interno do WhatsApp. Os relatórios detalhados ficam fora do Git em `D:\preditor-maintenance-backups\2026-09-19-mobile-qa`.

A interface e sincronização desta etapa pertencem somente ao LoginPercp; o Preditor original não recebe esses arquivos. A rotação de chaves anteriormente expostas permanece fora desta etapa, por decisão do responsável. Não publicar backups, credenciais de QA, tokens ou arquivos de ambiente.
