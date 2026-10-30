# Vídeos como contexto de investigação

Status: **To do**

## Resultado esperado

Antes da análise, transformar um vídeo autorizado ligado ao Report/card em evidência multimodal rastreável: frames relevantes, transcrição do áudio e linha do tempo. Os adaptadores recebem imagens e texto; extrair áudio sozinho não significa que Codex/Claude o interpretarão. Esta tarefa é um plano, sem implementação ou download ativado.

## Fluxo proposto

1. Resolver o anexo/link pela integração autorizada e baixar o arquivo para cache privado temporário. Aplicar limites de duração, tamanho e tempo, sem repassar credenciais a destinos de redirecionamento. Registrar origem, hash do arquivo e momento da coleta.
2. Separar áudio e amostrar frames localmente. Usar FFmpeg para decodificação e análise visual inicial; não enviar o vídeo inteiro repetidamente ao modelo.
3. Agrupar frames consecutivos visualmente semelhantes e escolher representantes estáveis. Ignorar pequenas mudanças isoladas de cursor e animação, sem usar apenas percentual global de pixels. Não juntar estados distantes da sequência: A → B → A continua sendo três etapas.
4. Detectar alterações de texto com OCR como sinal adicional de corte: mensagens de erro, números, labels e campos podem mudar em uma região pequena. Preservar os frames imediatamente antes/depois de uma mudança relevante e seus tempos; limitar frames, mas sinalizar explicitamente qualquer cobertura descartada pelo orçamento.
5. Transcrever o áudio com tempos usando um transcritor configurado e autorizado. Registrar trechos inaudíveis e ausência de transcritor; não inventar fala nem prometer suporte nativo de áudio dos adaptadores atuais.
6. Construir contexto com origem, tempos, frames e trechos da transcrição correlacionados. Fala do narrador é relato; a captura é observação visual. Nenhum dos dois substitui reprodução e testes.
7. Reutilizar o processamento pelo hash do vídeo e versão dos parâmetros. Guardar vídeo/áudio intermediários por até 30 dias, com limpeza na abertura e durante o uso; preservar evidências publicadas e registros de execução conforme sua política própria. Registrar as lacunas de coleta no Jira sem pedir que o usuário copie material já acessível.

## Organização e validação

Serviços separados para obtenção, extração, seleção temporal, transcrição e montagem do contexto, com contratos em arquivos de tipos e dependências injetadas. Integração como etapa de evidência anterior à triagem, compartilhável com Bug Fix e Development, sem condicionais concentradas no controlador.

Testes com vídeos sintéticos: cursor sem mudança de conteúdo; alteração curta de texto com poucos pixels; erro transitório; digitação; scroll; A → B → A; ausência de áudio; transcrição indisponível; arquivo inválido; limite de orçamento; retomada/cache e retenção. Não alegar entendimento completo quando frames ou trechos de áudio não foram processados.

## Referências

- [FFmpeg: filtros de vídeo e detecção de cenas](https://ffmpeg.org/ffmpeg-filters.html#scdet).
- [Tesseract: OCR local](https://tesseract-ocr.github.io/tessdoc/).

Decisão ainda necessária para implementação: qual transcritor autorizado e seu orçamento. O processamento de vídeo não faz parte da correção atual do Cardápio 3.0.
