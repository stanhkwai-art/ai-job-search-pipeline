// Title gate: only roles that fit your background reach /scrape, so the daily scoring stays small.
// hk: IT leadership, hands-on network / infrastructure / security / cloud roles at any level, and any low-latency or trading-infrastructure role.
// uk and contract: hands-on network, infrastructure, security, cloud and trading technology roles, AI and automation roles,
// Microsoft 365 roles, plus leadership.
const LOWLAT = /low.?latency|\bhft\b|trading (infrastructure|systems?|platform)|market data|kernel bypass/i;
const HARD_DROP = /\b(sales|account\w*|audit\w*|erp|oracle|peoplesoft|sap|crm|post-trade|payment|finance management|portfolio|marketing|product (manager|owner)|recruit\w*)\b/i;
const RESCUE = /\b(chief|head|director|vice president|svp|cio|cto|ciso)\b|\bvp\b/i;
const HK_SENIOR = /\b(head|director|chief|cio|cto|ciso|vp|vice president|svp|avp|manager|section head|team head|lead|principal|architect|controller)\b/i;
const HK_DOMAIN = /\b(it|ict|information technology|technology|tech|infrastructure|infra|network(s|ing)?|security|cyber\w*|cloud|data cent(er|re)|platform|operations|digital|ai|systems?|resilience|workplace|technical)\b/i;
const HK_CORE = /network|infrastructure|\binfra\b|security|cyber|cloud|systems? (engineer|administrator|analyst)|architect|data cent|platform engineer|\bsre\b|devops|technical consultant|it specialist|low.?latency/i;
const HK_DROP = /\b(intern|fresh grad|graduate|trainee|junior|technician|helpdesk|desktop|it support|support (officer|assistant|technician)|it assistant|officer|shift|clerk|sales|account|audit\w*|developer|java|erp|oracle|peoplesoft|sap|crm|product (manager|owner)|business intelligence|payment|post-trade|application development|software|functional|ux|designer|research|knowledge|portfolio|finance management|marketing)\b/i;
// Chinese titles (JobsDB, CTgoodjobs): no \b, since word boundaries don't apply to CJK text.
const ZH_SENIOR = /總監|总监|經理|经理|主管|總裁|总裁|首席|架構師|架构师|高級工程師|高级工程师|資深|资深/;
const ZH_DOMAIN = /資訊|资讯|信息科技|電腦|电脑|網絡|网络|網路|系統|系统|基建|基礎設施|基础设施|雲端|云端|數據中心|数据中心|科技/;
const ZH_CORE = /網絡工程師|网络工程师|網路工程師|系統工程師|系统工程师|系統管理員|系统管理员|資訊保安|資訊安全|信息安全|網絡安全|网络安全|網絡保安|雲端|云端|架構師|架构师|數據中心|数据中心|基礎設施|基础设施/;
const ZH_DROP = /實習|实习|見習|见习|畢業生|毕业生|初級|初级|技術員|技术员|文員|文员|銷售|销售|會計|会计|審計|审计|程式|程序員|程序员|開發|开发|編程|编程|支援|客戶|客户|市場|市场|招聘|助理(?!經理|经理)/;
const ZH_RESCUE = /總監|总监|總裁|总裁|首席/;
const UK_DOMAIN = /network|infrastructure|datacent|it operations manager|low.?latency|trading|market data|data cent|architect|security|firewall|cloud|platform|\bsre\b|site reliability|devops|systems? engineer|\bhead of\b|director|it manager|technical lead|resilience|\bai\b|artificial intelligence|\bllm|genai|generative|agentic|automation|\bn8n\b|copilot|microsoft 365|\bm365\b|office 365|\bo365\b|intune|exchange online|\bentra\b/i;
const UK_DROP = /\b(intern|graduate|apprentice|trainee|junior|technician|helpdesk|service desk|desktop|end user|field service|customer|support (analyst|specialist|engineer)|1st line|2nd line|first line|deployment specialist|business analyst|developer|software engineer|data (analyst|engineer|scientist)|sales|account|recruit\w*|teacher|nurse|test automation|qa|itsm|cad|payroll|training|volunteer|it support)\b/i;
// contract (widened 2026-11-08): every network, systems and cyber security engineering role, including sysadmin, SOC,
// vulnerability, IAM and virtualisation titles, and network/systems roles that say "support engineer".
const CONTRACT_EXTRA = /\bsoc\b|cyber|systems? admin\w*|sysadmin|vulnerabilit\w*|penetration|pen ?test\w*|incident response|identity and access|\biam\b|\bgrc\b|wintel|vmware|virtuali[sz]ation|server engineer|linux|windows (server|engineer)|\bnoc\b/i;
const TECH_SUPPORT = /network|systems?|security|cyber|infrastructure|\bnoc\b/i;
function fits(track, title) {
  const t = String(title || '');
  if (LOWLAT.test(t)) return true;
  if (HARD_DROP.test(t)) return false;
  // HK (relaxed 2026-11-07): senior IT roles, plus hands-on network, infrastructure, security and cloud roles at any level.
  // Pay below the HK floor (PAY_FLOOR in wf1.js) is dropped in route() when the alert states it.
  if (track === 'hk') {
    const senior = HK_SENIOR.test(t) || ZH_SENIOR.test(t), domain = HK_DOMAIN.test(t) || ZH_DOMAIN.test(t);
    const drop = HK_DROP.test(t) || ZH_DROP.test(t), rescue = RESCUE.test(t) || ZH_RESCUE.test(t);
    return (senior && domain || HK_CORE.test(t) || ZH_CORE.test(t)) && (!drop || rescue);
  }
  if (track === 'contract') {
    const drop = UK_DROP.test(TECH_SUPPORT.test(t) ? t.replace(/\b(support (analyst|specialist|engineer)|2nd line|second line)\b/ig, '') : t);
    return (UK_DOMAIN.test(t) || CONTRACT_EXTRA.test(t)) && (!drop || RESCUE.test(t));
  }
  return UK_DOMAIN.test(t) && (!UK_DROP.test(t) || RESCUE.test(t));
}
