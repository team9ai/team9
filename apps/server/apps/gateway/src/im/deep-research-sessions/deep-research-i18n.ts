type DeepResearchUiLanguage =
  | 'en'
  | 'zh-CN'
  | 'zh-TW'
  | 'de'
  | 'es'
  | 'fr'
  | 'it'
  | 'ja'
  | 'ko'
  | 'nl'
  | 'pt'
  | 'ru';
export type DeepResearchTextKey =
  | 'actionModifyPlan'
  | 'actionFollowUp'
  | 'actionStartResearch'
  | 'activeStepStarting'
  | 'childGeneratingPlan'
  | 'childAnswering'
  | 'childStartedResearch'
  | 'heartbeatPlan'
  | 'heartbeatAnswering'
  | 'heartbeatResearch'
  | 'progressCompleted'
  | 'parentFailed'
  | 'parentPlanReady'
  | 'parentCompleted'
  | 'parentGeneratingPlan'
  | 'parentRunning'
  | 'failureMessage'
  | 'unknownError'
  | 'truncated';

const DEEP_RESEARCH_TEXT: Record<
  DeepResearchUiLanguage,
  Record<DeepResearchTextKey, string>
> = {
  en: {
    actionModifyPlan: 'Modify research plan',
    actionFollowUp: 'Follow up',
    actionStartResearch: 'Start research',
    activeStepStarting: 'Starting research',
    childGeneratingPlan: 'Generating research plan...',
    childAnswering: 'Generating an answer from the report...',
    childStartedResearch: 'Started deep research...',
    heartbeatPlan: 'Research plan is still being generated',
    heartbeatAnswering: 'Waiting for the report-based answer',
    heartbeatResearch: 'Research is still running, waiting for more results',
    progressCompleted: 'Research completed',
    parentFailed: 'Deep Research "{title}" failed: {error}',
    parentPlanReady:
      'Deep Research "{title}" plan is ready, waiting for approval',
    parentCompleted: 'Deep Research "{title}" report is complete',
    parentGeneratingPlan:
      'Deep Research "{title}" is generating a research plan',
    parentRunning: 'Deep Research "{title}" is running',
    failureMessage: 'Deep research failed: {error}',
    unknownError: 'Unknown error',
    truncated: '[Content too long, truncated]',
  },
  'zh-CN': {
    actionModifyPlan: '修改研究方案',
    actionFollowUp: '继续追问',
    actionStartResearch: '开始研究',
    activeStepStarting: '正在启动研究',
    childGeneratingPlan: '正在生成研究计划...',
    childAnswering: '正在基于报告生成回答...',
    childStartedResearch: '已开始执行深度研究...',
    heartbeatPlan: '研究计划仍在生成中',
    heartbeatAnswering: '正在等待基于报告的回答',
    heartbeatResearch: '研究仍在进行，等待更多结果',
    progressCompleted: '研究完成',
    parentFailed: '深度研究“{title}”失败：{error}',
    parentPlanReady: '深度研究“{title}”研究计划已生成，等待确认',
    parentCompleted: '深度研究“{title}”报告已完成',
    parentGeneratingPlan: '深度研究“{title}”正在生成研究计划',
    parentRunning: '深度研究“{title}”正在执行研究',
    failureMessage: '深度研究失败：{error}',
    unknownError: '未知错误',
    truncated: '[内容过长，已截断]',
  },
  'zh-TW': {
    actionModifyPlan: '修改研究計畫',
    actionFollowUp: '繼續追問',
    actionStartResearch: '開始研究',
    activeStepStarting: '正在啟動研究',
    childGeneratingPlan: '正在生成研究計畫...',
    childAnswering: '正在根據報告生成回答...',
    childStartedResearch: '已開始執行深度研究...',
    heartbeatPlan: '研究計畫仍在生成中',
    heartbeatAnswering: '正在等待根據報告生成的回答',
    heartbeatResearch: '研究仍在進行，等待更多結果',
    progressCompleted: '研究完成',
    parentFailed: '深度研究「{title}」失敗：{error}',
    parentPlanReady: '深度研究「{title}」研究計畫已生成，等待確認',
    parentCompleted: '深度研究「{title}」報告已完成',
    parentGeneratingPlan: '深度研究「{title}」正在生成研究計畫',
    parentRunning: '深度研究「{title}」正在執行研究',
    failureMessage: '深度研究失敗：{error}',
    unknownError: '未知錯誤',
    truncated: '[內容過長，已截斷]',
  },
  de: {
    actionModifyPlan: 'Rechercheplan anpassen',
    actionFollowUp: 'Nachfragen',
    actionStartResearch: 'Recherche starten',
    activeStepStarting: 'Recherche wird gestartet',
    childGeneratingPlan: 'Rechercheplan wird erstellt...',
    childAnswering: 'Antwort aus dem Bericht wird erstellt...',
    childStartedResearch: 'Deep Research wurde gestartet...',
    heartbeatPlan: 'Der Rechercheplan wird noch erstellt',
    heartbeatAnswering: 'Warte auf die berichtbasierte Antwort',
    heartbeatResearch: 'Die Recherche laeuft weiter und wartet auf Ergebnisse',
    progressCompleted: 'Recherche abgeschlossen',
    parentFailed: 'Deep Research "{title}" fehlgeschlagen: {error}',
    parentPlanReady:
      'Deep Research "{title}" Plan ist bereit und wartet auf Bestaetigung',
    parentCompleted: 'Deep Research "{title}" Bericht ist fertig',
    parentGeneratingPlan:
      'Deep Research "{title}" erstellt einen Rechercheplan',
    parentRunning: 'Deep Research "{title}" laeuft',
    failureMessage: 'Deep Research fehlgeschlagen: {error}',
    unknownError: 'Unbekannter Fehler',
    truncated: '[Inhalt zu lang, gekuerzt]',
  },
  es: {
    actionModifyPlan: 'Modificar plan de investigacion',
    actionFollowUp: 'Hacer seguimiento',
    actionStartResearch: 'Iniciar investigacion',
    activeStepStarting: 'Iniciando investigacion',
    childGeneratingPlan: 'Generando plan de investigacion...',
    childAnswering: 'Generando una respuesta basada en el informe...',
    childStartedResearch: 'Investigacion profunda iniciada...',
    heartbeatPlan: 'El plan de investigacion sigue generandose',
    heartbeatAnswering: 'Esperando la respuesta basada en el informe',
    heartbeatResearch:
      'La investigacion sigue en curso, esperando mas resultados',
    progressCompleted: 'Investigacion completada',
    parentFailed: 'Deep Research "{title}" fallo: {error}',
    parentPlanReady:
      'El plan de Deep Research "{title}" esta listo y espera aprobacion',
    parentCompleted: 'El informe de Deep Research "{title}" esta completo',
    parentGeneratingPlan:
      'Deep Research "{title}" esta generando un plan de investigacion',
    parentRunning: 'Deep Research "{title}" esta en curso',
    failureMessage: 'Deep research fallo: {error}',
    unknownError: 'Error desconocido',
    truncated: '[Contenido demasiado largo, truncado]',
  },
  fr: {
    actionModifyPlan: 'Modifier le plan de recherche',
    actionFollowUp: 'Poser une question de suivi',
    actionStartResearch: 'Lancer la recherche',
    activeStepStarting: 'Demarrage de la recherche',
    childGeneratingPlan: 'Generation du plan de recherche...',
    childAnswering: 'Generation d une reponse a partir du rapport...',
    childStartedResearch: 'Recherche approfondie lancee...',
    heartbeatPlan: 'Le plan de recherche est encore en cours de generation',
    heartbeatAnswering: 'En attente de la reponse basee sur le rapport',
    heartbeatResearch:
      'La recherche est toujours en cours, en attente de nouveaux resultats',
    progressCompleted: 'Recherche terminee',
    parentFailed: 'Deep Research "{title}" a echoue : {error}',
    parentPlanReady:
      'Le plan Deep Research "{title}" est pret et attend validation',
    parentCompleted: 'Le rapport Deep Research "{title}" est termine',
    parentGeneratingPlan: 'Deep Research "{title}" genere un plan de recherche',
    parentRunning: 'Deep Research "{title}" est en cours',
    failureMessage: 'Deep research a echoue : {error}',
    unknownError: 'Erreur inconnue',
    truncated: '[Contenu trop long, tronque]',
  },
  it: {
    actionModifyPlan: 'Modifica piano di ricerca',
    actionFollowUp: 'Fai una domanda di follow-up',
    actionStartResearch: 'Avvia ricerca',
    activeStepStarting: 'Avvio della ricerca',
    childGeneratingPlan: 'Generazione del piano di ricerca...',
    childAnswering: 'Generazione di una risposta dal report...',
    childStartedResearch: 'Ricerca approfondita avviata...',
    heartbeatPlan: 'Il piano di ricerca e ancora in generazione',
    heartbeatAnswering: 'In attesa della risposta basata sul report',
    heartbeatResearch:
      'La ricerca e ancora in corso, in attesa di altri risultati',
    progressCompleted: 'Ricerca completata',
    parentFailed: 'Deep Research "{title}" non riuscita: {error}',
    parentPlanReady:
      'Il piano Deep Research "{title}" e pronto e attende approvazione',
    parentCompleted: 'Il report Deep Research "{title}" e completo',
    parentGeneratingPlan:
      'Deep Research "{title}" sta generando un piano di ricerca',
    parentRunning: 'Deep Research "{title}" e in corso',
    failureMessage: 'Deep research non riuscita: {error}',
    unknownError: 'Errore sconosciuto',
    truncated: '[Contenuto troppo lungo, troncato]',
  },
  ja: {
    actionModifyPlan: '調査計画を変更',
    actionFollowUp: '追加で質問',
    actionStartResearch: '調査を開始',
    activeStepStarting: '調査を開始中',
    childGeneratingPlan: '調査計画を作成中...',
    childAnswering: 'レポートに基づく回答を生成中...',
    childStartedResearch: 'Deep Research を開始しました...',
    heartbeatPlan: '調査計画をまだ作成しています',
    heartbeatAnswering: 'レポートに基づく回答を待っています',
    heartbeatResearch: '調査は継続中です。追加結果を待っています',
    progressCompleted: '調査完了',
    parentFailed: 'Deep Research「{title}」が失敗しました: {error}',
    parentPlanReady:
      'Deep Research「{title}」の調査計画が生成され、確認待ちです',
    parentCompleted: 'Deep Research「{title}」のレポートが完了しました',
    parentGeneratingPlan: 'Deep Research「{title}」の調査計画を作成中です',
    parentRunning: 'Deep Research「{title}」を実行中です',
    failureMessage: 'Deep research が失敗しました: {error}',
    unknownError: '不明なエラー',
    truncated: '[内容が長すぎるため切り詰めました]',
  },
  ko: {
    actionModifyPlan: '연구 계획 수정',
    actionFollowUp: '후속 질문',
    actionStartResearch: '연구 시작',
    activeStepStarting: '연구 시작 중',
    childGeneratingPlan: '연구 계획 생성 중...',
    childAnswering: '보고서를 바탕으로 답변 생성 중...',
    childStartedResearch: 'Deep Research를 시작했습니다...',
    heartbeatPlan: '연구 계획을 계속 생성 중입니다',
    heartbeatAnswering: '보고서 기반 답변을 기다리는 중입니다',
    heartbeatResearch: '연구가 계속 진행 중이며 추가 결과를 기다립니다',
    progressCompleted: '연구 완료',
    parentFailed: 'Deep Research "{title}" 실패: {error}',
    parentPlanReady:
      'Deep Research "{title}" 연구 계획이 준비되어 승인 대기 중입니다',
    parentCompleted: 'Deep Research "{title}" 보고서가 완료되었습니다',
    parentGeneratingPlan: 'Deep Research "{title}" 연구 계획을 생성 중입니다',
    parentRunning: 'Deep Research "{title}" 실행 중입니다',
    failureMessage: 'Deep research 실패: {error}',
    unknownError: '알 수 없는 오류',
    truncated: '[내용이 너무 길어 잘렸습니다]',
  },
  nl: {
    actionModifyPlan: 'Onderzoeksplan aanpassen',
    actionFollowUp: 'Vervolgvraag stellen',
    actionStartResearch: 'Onderzoek starten',
    activeStepStarting: 'Onderzoek wordt gestart',
    childGeneratingPlan: 'Onderzoeksplan wordt gemaakt...',
    childAnswering: 'Antwoord uit het rapport wordt gemaakt...',
    childStartedResearch: 'Deep Research gestart...',
    heartbeatPlan: 'Het onderzoeksplan wordt nog gemaakt',
    heartbeatAnswering: 'Wachten op het antwoord op basis van het rapport',
    heartbeatResearch: 'Het onderzoek loopt nog en wacht op meer resultaten',
    progressCompleted: 'Onderzoek voltooid',
    parentFailed: 'Deep Research "{title}" mislukt: {error}',
    parentPlanReady:
      'Deep Research "{title}" plan is klaar en wacht op goedkeuring',
    parentCompleted: 'Deep Research "{title}" rapport is voltooid',
    parentGeneratingPlan: 'Deep Research "{title}" maakt een onderzoeksplan',
    parentRunning: 'Deep Research "{title}" wordt uitgevoerd',
    failureMessage: 'Deep research mislukt: {error}',
    unknownError: 'Onbekende fout',
    truncated: '[Inhoud te lang, ingekort]',
  },
  pt: {
    actionModifyPlan: 'Modificar plano de pesquisa',
    actionFollowUp: 'Pergunta de acompanhamento',
    actionStartResearch: 'Iniciar pesquisa',
    activeStepStarting: 'Iniciando pesquisa',
    childGeneratingPlan: 'Gerando plano de pesquisa...',
    childAnswering: 'Gerando uma resposta com base no relatorio...',
    childStartedResearch: 'Pesquisa aprofundada iniciada...',
    heartbeatPlan: 'O plano de pesquisa ainda esta sendo gerado',
    heartbeatAnswering: 'Aguardando a resposta baseada no relatorio',
    heartbeatResearch:
      'A pesquisa ainda esta em andamento, aguardando mais resultados',
    progressCompleted: 'Pesquisa concluida',
    parentFailed: 'Deep Research "{title}" falhou: {error}',
    parentPlanReady:
      'O plano do Deep Research "{title}" esta pronto e aguarda aprovacao',
    parentCompleted: 'O relatorio do Deep Research "{title}" foi concluido',
    parentGeneratingPlan:
      'Deep Research "{title}" esta gerando um plano de pesquisa',
    parentRunning: 'Deep Research "{title}" esta em execucao',
    failureMessage: 'Deep research falhou: {error}',
    unknownError: 'Erro desconhecido',
    truncated: '[Conteudo longo demais, truncado]',
  },
  ru: {
    actionModifyPlan: 'Изменить план исследования',
    actionFollowUp: 'Задать уточняющий вопрос',
    actionStartResearch: 'Начать исследование',
    activeStepStarting: 'Запуск исследования',
    childGeneratingPlan: 'Формируется план исследования...',
    childAnswering: 'Формируется ответ на основе отчета...',
    childStartedResearch: 'Глубокое исследование запущено...',
    heartbeatPlan: 'План исследования все еще формируется',
    heartbeatAnswering: 'Ожидание ответа на основе отчета',
    heartbeatResearch:
      'Исследование продолжается, ожидаются дополнительные результаты',
    progressCompleted: 'Исследование завершено',
    parentFailed: 'Deep Research "{title}" завершился ошибкой: {error}',
    parentPlanReady:
      'План Deep Research "{title}" готов и ожидает подтверждения',
    parentCompleted: 'Отчет Deep Research "{title}" готов',
    parentGeneratingPlan: 'Deep Research "{title}" формирует план исследования',
    parentRunning: 'Deep Research "{title}" выполняется',
    failureMessage: 'Deep research завершился ошибкой: {error}',
    unknownError: 'Неизвестная ошибка',
    truncated: '[Содержимое слишком длинное и было обрезано]',
  },
};

function normalizeLanguageTag(
  language: string | null | undefined,
): string | null {
  const normalized = language?.trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (
    lower === 'zh-tw' ||
    lower === 'zh-hant' ||
    lower.startsWith('zh-hant-') ||
    lower === 'zh-hk' ||
    lower === 'zh-mo'
  ) {
    return 'zh-TW';
  }
  if (
    lower === 'zh' ||
    lower === 'zh-cn' ||
    lower === 'zh-hans' ||
    lower.startsWith('zh-hans-') ||
    lower === 'zh-sg'
  ) {
    return 'zh-CN';
  }
  return lower.split('-')[0] || null;
}

function resolveDeepResearchUiLanguage(
  language: string | null | undefined,
): DeepResearchUiLanguage {
  const normalized = normalizeLanguageTag(language);
  if (
    normalized === 'zh-CN' ||
    normalized === 'zh-TW' ||
    normalized === 'de' ||
    normalized === 'es' ||
    normalized === 'fr' ||
    normalized === 'it' ||
    normalized === 'ja' ||
    normalized === 'ko' ||
    normalized === 'nl' ||
    normalized === 'pt' ||
    normalized === 'ru' ||
    normalized === 'en'
  ) {
    return normalized;
  }
  return 'en';
}

export function deepResearchText(
  language: string | null | undefined,
  key: DeepResearchTextKey,
  values?: Record<string, string>,
): string {
  const dictionary =
    DEEP_RESEARCH_TEXT[resolveDeepResearchUiLanguage(language)];
  let template = dictionary[key] ?? DEEP_RESEARCH_TEXT.en[key];
  for (const [name, value] of Object.entries(values ?? {})) {
    template = template.split(`{${name}}`).join(value);
  }
  return template;
}
