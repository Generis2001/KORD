import type { SourceLoader } from '../../src/public-sources.js';

export const nigeriaPages = {
  'https://energy-news.org/solar-nigeria': [
    'But with grid collapses and blackouts still a common reality, off-grid solar will have to develop quickly in order to provide better and cleaner power connectivity for Nigerians by 2030 – the government’s target year for universal energy access.',
    'Chinese companies are likely to continue playing a role. At the 3rd Belt and Road Forum, held in Beijing in October, the Nigeria government received US$4 billion worth of “letters of intent” for investments and new projects in solar, clean energy and smart grid initiatives.',
  ],
  'https://finance-news.org/solar-nigeria': [
    'He said: “This is a testament to our dedication and commitment to scaling the off-grid solar market through provision of long term low interest credit facilities to the Nigeria Electrification Project pre-qualified home solar value chain players that include manufacturers and assemblers of solar components and off-grid energy developers and retailers in the country.”',
  ],
  'https://energy-policy.org/solar-nigeria': [
    'Incentivise the creation of 250,000 new jobs in the energy sector. The Solar Connection Intervention Facility from the Central Bank of Nigeria (CBN), will complement the Federal government’s effort of providing affordable electricity to unserved rural communities through the provision of long-term low-interest credit facilities to the Nigeria Electrification Project (NEP) pre-qualified SHS distributors and mini grid development companies. This also includes qualified home solar value chain players such as manufacturers and assemblers of solar components.',
  ],
  'https://business-news.org/solar-nigeria': [
    'However, WiSolar, a green digital energy provider based in South Africa, is set to change the narrative by providing simplified solar solutions that can power over one million houses in Nigeria.',
    'In addition to providing solar solutions, WiSolar is also investing in local training and capacity-building programs to help create jobs and promote entrepreneurship in the renewable energy sector. The company aims to empower local communities to become self-sufficient in energy production and management, which can have significant economic and social benefits. The on-demand solar electricity platform is available in South Africa, Nigeria and Zimbabwe with plans to launch in Australia in the near future.',
  ],
};
export const nigeriaGoal = 'Research solar energy in Nigeria at ' + Object.keys(nigeriaPages).join(' ');
export const nigeriaLoader: SourceLoader = async url => {
  const passages = nigeriaPages[url as keyof typeof nigeriaPages];
  if (!passages) throw new Error('Unavailable fixture page');
  return { url, body: '<title>Solar energy in Nigeria</title>' + passages.map(passage => `<p>${passage}</p>`).join(''), contentType: 'text/html', retrievedAt: new Date().toISOString() };
};
