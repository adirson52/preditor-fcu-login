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
- Arquivar/restaurar percepção não equivale a excluir permanentemente um usuário. A função antiga de exclusão de usuários da Master continua destrutiva; usar bloqueio quando precisar preservar todo o histórico.

## Rotina segura de publicação

1. `git status`: identificar e preservar alterações anteriores.
2. `npm test`: testes locais simulados. `npm run test:e2e` é a bateria de navegador separada.
3. Commitar apenas fontes/regras/testes/documentação, nunca `.env`, `.vercel`, backups ou credenciais.
4. Publicar candidato na Vercel, conferir arquivos e endpoints, e só então promover. O projeto LoginPercp também possui integração com GitHub; considerar o deploy automático de `main` antes de um push.
5. Comparar os arquivos servidos com os fontes e registrar o commit publicado.

## O que não foi validado integralmente nesta etapa

Por solicitação do responsável, a bateria completa em celulares, múltiplos navegadores, contas reais, exportações e todos os fluxos administrativos fica para depois. Testes simulados e checagens pontuais de publicação não equivalem à aprovação completa em produção.

As correções de cache/concorrência não exigem migração do banco. A rotação da chave de serviço exposta anteriormente na Master é uma pendência de segurança independente: atualizar os consumidores e revogar a chave antiga no painel Supabase, sem enviar chaves por chat.
