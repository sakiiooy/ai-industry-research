/**
 * Small, synthetic bilingual training corpus for an advisory evidence classifier.
 * These examples teach language patterns. They are NOT company facts or sources.
 * Labels express evidence type, never investment merit or certainty.
 */
export const trainingExamples = Object.freeze([
  { grade: 'E1', text: '年度报告披露扫地机器人业务营业收入100亿元，报告期2024年。' },
  { grade: 'E1', text: '年报分产品收入表：家用清洁机器人销售收入20亿元人民币。' },
  { grade: 'E1', text: '公司财务报告披露机器人品类收入5.2亿元，含对应报告期间及业务口径。' },
  { grade: 'E1', text: '机器人销售业务实现营业收入2亿元，来自经审计年度财务报表。' },
  { grade: 'E1', text: 'Annual report discloses robot vacuum segment revenue of USD 100 million in fiscal 2024.' },
  { grade: 'E1', text: 'Audited financial statements report floor cleaning robot sales revenue of $250 million.' },
  { grade: 'E2', text: '公司官网展示在售扫地机器人产品，未单独披露收入。' },
  { grade: 'E2', text: '品牌官方商城销售家用清洁机器人，产品已经上市并交付。' },
  { grade: 'E2', text: '公司有已量产机器人和正式在售产品，但缺少该业务单独财务数据。' },
  { grade: 'E2', text: '官方产品页面介绍扫拖机器人型号与规格，可以购买，收入未披露。' },
  { grade: 'E2', text: 'The official store sells a robot vacuum product; product-specific revenue is not disclosed.' },
  { grade: 'E2', text: 'Commercial robot cleaners have shipped to customers. The company has an official product page.' },
  { grade: 'E3', text: '公告披露正在研发机器人项目，尚未量产。' },
  { grade: 'E3', text: '公司签署机器人合作协议，项目处于研发与测试阶段。' },
  { grade: 'E3', text: '正式公告机器人研发进展和样机测试，未来是否商业化仍不确定。' },
  { grade: 'E3', text: '公司宣布机器人项目立项，实验室原型正在试验。' },
  { grade: 'E3', text: 'The company announced a research project and signed a development cooperation agreement.' },
  { grade: 'E3', text: 'An official announcement describes prototype testing and research development, before mass production.' },
  { grade: 'E4', text: '管理层表示未来关注机器人赛道，计划探索相关机会。' },
  { grade: 'E4', text: '公司战略愿景提到机器人，只有概念性表态。' },
  { grade: 'E4', text: '公司称看好机器人发展前景，未来可能布局。' },
  { grade: 'E4', text: '在交流中表示有意探索机器人领域，暂无具体项目。' },
  { grade: 'E4', text: 'Management expresses interest in exploring robotics as a future strategic opportunity.' },
  { grade: 'E4', text: 'The company states a vision and may consider entering the robotics market in the future.' },
  { grade: 'E5', text: '在已检查的公告和年度报告中未找到相关业务证据。' },
  { grade: 'E5', text: '没有可靠来源支持公司与扫地机器人业务存在联系。' },
  { grade: 'E5', text: '公司明确否认开展机器人业务，相关传闻缺乏证据。' },
  { grade: 'E5', text: '信息不足，无法确认相关业务，不能作出事实结论。' },
  { grade: 'E5', text: 'No supporting business evidence was found in the reviewed public sources.' },
  { grade: 'E5', text: 'The company denies having robotics operations. The market rumor is unverified.' },
].map(example => Object.freeze(example)));

export const trainingMetadata = Object.freeze({
  version: 'nb-evidence-1.0',
  provenance: 'Synthetic bilingual examples authored for this prototype; not financial evidence.',
  labels: ['E1', 'E2', 'E3', 'E4', 'E5'],
  scoreMeaning: 'Relative model scores on a tiny training corpus, not probabilities that a business claim is true.',
});
