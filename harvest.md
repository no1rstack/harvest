The most immediately usable corpus appears to be the roughly 13,993 community_items, supported by feed-source, policy, stream-status, timestamps, source metadata, and whatever entities, topics, locations, links, and classifications are already stored on those records. The intelligence tables do not need to be populated before basic multidimensional analysis begins.

1. Establish the analytical dimensions

Each item should be filterable and groupable across a consistent set of dimensions.

Source dimensions
Feed source
Publisher
Source domain
Source type
Collection method
Collection policy
Reliability
Language
Country of origin
Content dimensions
Topic
Subtopic
Sector
Industry
Technology
Organization
Person
Product
Program
Event type
Document type
Geographic dimensions
Country
Region
State or province
City
Coordinates
Operational theater
Jurisdiction
Origin location
Affected location
Temporal dimensions
Published date
Collected date
First observed
Last observed
Event date
Updated date
Hour
Day
Week
Month
Quarter
Recency band
Analytical dimensions
Relevance
Confidence
Severity
Novelty
Momentum
Source count
Corroboration count
Contradiction count
Sentiment
Risk category
Strategic importance
Relationship dimensions
Person → organization
Organization → country
Company → technology
Event → location
Claim → evidence
Article → entity
Source → narrative
Organization → contract
Company → sanction
Event → prior event

These become the shared vocabulary for every table, chart, search, report, alert, and Context Fabric.

2. Slice the data

A slice applies one or more filters and gives you a focused subset.

Examples:

All items about maritime activity
All China-related technology items published in the last 30 days
Items from government sources mentioning semiconductor export controls
High-relevance cyber items with fewer than two corroborating sources
All items collected from one feed source but never displayed in the UI

Useful Harvest slices would include:

Topic slice
Country slice
Source slice
Time slice
Entity slice
Risk slice
Confidence slice
Collection-policy slice
Unused-data slice
Evidence-quality slice

A slice should be saveable as a reusable lens, not reconstructed manually every time.

For example:

Lens: Emerging Maritime Disruption

Filters:
sector = maritime
published_at <= 14 days
novelty >= 0.65
source_count >= 2
event_type IN disruption, closure, seizure, collision
3. Dice the data

Dicing compares several dimensions simultaneously.

Examples:

Source × topic

Which sources cover which topics?

Rows: source
Columns: topic
Value: item count

This reveals:

source specialization
topic gaps
overdependence on one publisher
duplicate coverage
collection imbalance
Country × sector × time
Rows: country
Columns: sector
Filter: last 30 days
Value: weekly item count

This shows where activity is increasing or decreasing.

Entity × source × confidence
Rows: entity
Columns: publisher
Value: average confidence

This helps determine whether an assessment is broadly supported or driven by one source.

Topic × sentiment × time
Rows: week
Columns: sentiment
Filter: topic = artificial intelligence
Value: article count

This exposes narrative shifts.

Collection policy × output
Rows: collection policy
Columns: result type
Values:
- collected items
- unique items
- duplicates
- entities extracted
- findings produced

This shows which collection policies generate useful information rather than volume alone.

4. Create standard analytical lenses

Harvest should provide a small number of reusable lenses over the same corpus.

Source Lens

Answers:

Where did this information come from?
Which sources dominate coverage?
Which sources duplicate one another?
Which sources produce unique information?
Which sources have gone silent?
Entity Lens

Answers:

Which people, companies, agencies, systems, or locations appear most frequently?
Which entities are newly emerging?
Which entities occur together?
Which entities connect otherwise separate subjects?
Temporal Lens

Answers:

What changed?
When did it begin?
Is activity accelerating?
Is this recurring or anomalous?
What was the first observable signal?
Geographic Lens

Answers:

Where is activity concentrated?
Which regions share the same trend?
Which location is mentioned versus actually affected?
Which entities operate across multiple jurisdictions?
Narrative Lens

Answers:

Which claims or themes are spreading?
Which sources introduced them?
How has wording changed?
Are multiple sources repeating the same original report?
Are competing narratives present?
Evidence Lens

Answers:

What evidence supports an assertion?
How many independent sources support it?
Are the sources genuinely independent?
What contradicts it?
What remains uncertain?
Operational Lens

Answers:

Which collectors are running?
Which feeds are producing data?
Which policies create the most useful records?
Where is data being collected but not consumed?
Which downstream process has not run?
5. Generate higher-value derived fields

You can calculate useful analytical fields from existing records without adding new external sources.

Source diversity
distinct source domains supporting an entity, claim, or topic
Corroboration
number of independent sources reporting the same event or claim
Coverage velocity
items in current period ÷ items in prior comparable period
Novelty
how different an item is from previously collected material
Persistence
number of time periods in which a topic or entity remains active
Entity centrality
how frequently an entity connects different clusters
Source exclusivity
percentage of a source’s records not found elsewhere
Staleness
time since a feed, entity, topic, or source last produced new information
Collection yield
unique useful findings ÷ collection executions
Duplication rate
duplicates ÷ total collected records

These fields allow Harvest to rank and compare data rather than only display it.

6. Turn the existing data into cross-source products

Once the dimensions exist, you can build editorial and analytical products from the same records.

Significant Changes

Compare current and previous periods:

This week versus last week
This month versus prior month
Current source distribution versus baseline
Current entity activity versus normal activity
Emerging Entities

Identify people, organizations, locations, or technologies whose mention volume is rising rapidly from a low baseline.

Source Divergence

Find events where different publishers describe the same facts differently.

Coverage Gaps

Identify strategic topics with low source diversity, stale collection, or no recent records.

Relationship Discovery

Find entities that co-occur repeatedly but do not yet have an explicit relationship.

Narrative Formation

Cluster semantically similar records, identify the first source, measure propagation, and compare variations.

Strategic Convergence

Detect when multiple domains intersect, such as:

shipping + sanctions + insurance + energy

or:

government procurement + artificial intelligence + surveillance
Evidence Packages

Group records by claim or event and present:

supporting sources
contradictory sources
timeline
involved entities
geographic context
confidence
unresolved questions
7. Use a pivot-style interface

The interface should allow users to choose:

Dataset
Measure
Rows
Columns
Filters
Time range
Sort
Visualization

Example:

Dataset: community_items
Measure: item count
Rows: country
Columns: topic
Filters: last 30 days, source reliability >= medium
Sort: highest change
Visualization: matrix

Another:

Dataset: community_items
Measure: distinct source count
Rows: organization
Columns: week
Filters: sector = energy
Visualization: trend table

The same query should be viewable as:

table
matrix
timeline
map
network
histogram
editorial brief
8. Start with the data you already have

Given the current state, the first implementation should use:

community_items
community_feed_sources
collection_policies
community_stream_status

Join them into one analytical view.

Conceptually:

CREATE VIEW harvest_item_analysis AS
SELECT
    i.id,
    i.title,
    i.url,
    i.published_at,
    i.collected_at,
    i.source_id,
    s.name AS source_name,
    s.domain AS source_domain,
    s.source_type,
    s.country AS source_country,
    p.name AS collection_policy,
    st.status AS stream_status
FROM community_items i
LEFT JOIN community_feed_sources s
    ON s.id = i.source_id
LEFT JOIN collection_policies p
    ON p.id = s.collection_policy_id
LEFT JOIN community_stream_status st
    ON st.stream_id = s.stream_id;

The exact columns and keys will depend on the real schema, but the principle is to expose a flattened analytical layer without destroying the normalized source tables.

Then add derived views:

harvest_source_performance
harvest_topic_trends
harvest_entity_activity
harvest_geographic_activity
harvest_collection_yield
harvest_duplicate_analysis
harvest_unused_data
harvest_temporal_changes
9. Recommended first dashboards

Build these first because they can expose immediate value and pipeline problems.

Corpus Overview
total records
unique sources
records by day
records by source
records by topic
duplicates
stale feeds
Source Performance
total items per source
unique items
duplication rate
last successful collection
average items per run
failed collection count
Significant Changes
fastest-growing topics
fastest-growing entities
newly active countries
declining topics
newly silent sources
Data Utilization
collected records displayed in UI
records used by search
records used by analysis
records with extracted entities
records with geographic fields
records with no downstream consumer
Evidence and Corroboration
single-source claims
multi-source claims
contradictory clusters
source concentration
unresolved assertions
10. The most important architectural rule

Do not build separate datasets for each dashboard.

Preserve a common analytical model:

Source facts
    ↓
Normalized records
    ↓
Entities, events, claims and locations
    ↓
Relationships
    ↓
Derived analytical measures
    ↓
Reusable lenses
    ↓
Dashboards, maps, reports and Context Fabrics

The core principle is:

Collect once, normalize once, relate once, and analyze through many lenses.

For Harvest, I would begin with a unified Item Analysis View, a Source Performance View, and a Significant Change View. Those three surfaces would immediately let you examine what is present, where it came from, what is changing, what is duplicated, and what is currently being collected without producing analytical value.


Additional Sources to add:
Diplomacy and Foreign Policy

- [UN Digital Library](https://digitallibrary.un.org/)
    
- [UN Treaty Collection](https://treaties.un.org/)
    
- [UN Security Council](https://main.un.org/securitycouncil/)
    
- [UN General Assembly Voting Data](https://digitallibrary.un.org/search?ln=en&cc=Voting+Data)
    
- [European External Action Service](https://www.eeas.europa.eu/)
    
- [United Kingdom Foreign Office](https://www.gov.uk/government/organisations/foreign-commonwealth-development-office)
    
- [France Diplomacy](https://www.diplomatie.gouv.fr/en/)
    
- [Germany Federal Foreign Office](https://www.auswaertiges-amt.de/en)
    
- [Japan Ministry of Foreign Affairs](https://www.mofa.go.jp/)
    
- [China Ministry of Foreign Affairs](https://www.fmprc.gov.cn/eng/)
    
- [India Ministry of External Affairs](https://www.mea.gov.in/)
    
- [Canada Global Affairs](https://www.international.gc.ca/)
    
- [Australia Department of Foreign Affairs and Trade](https://www.dfat.gov.au/)
    

## Legislation, Regulations and Official Gazettes

- [Inter-Parliamentary Union Parline](https://data.ipu.org/)
    
- [Law Library of Congress Foreign Gazettes](https://www.loc.gov/law/help/government-gazettes/)
    
- [World Legal Information Institute](https://www.worldlii.org/)
    
- [EUR-Lex](https://eur-lex.europa.eu/)
    
- [EU National Parliament Exchange — IPEX](https://secure.ipex.eu/)
    
- [United Kingdom Legislation](https://www.legislation.gov.uk/)
    
- [France Légifrance](https://www.legifrance.gouv.fr/)
    
- [Germany Federal Laws](https://www.gesetze-im-internet.de/)
    
- [Italy Official Gazette](https://www.gazzettaufficiale.it/)
    
- [Spain Official State Gazette](https://www.boe.es/)
    
- [Japan e-Gov Laws](https://elaws.e-gov.go.jp/)
    
- [India e-Gazette](https://egazette.gov.in/)
    
- [Australia Federal Register of Legislation](https://www.legislation.gov.au/)
    
- [Canada Justice Laws](https://laws-lois.justice.gc.ca/)
    
- [Singapore Statutes Online](https://sso.agc.gov.sg/)
    
- [WIPO Lex](https://www.wipo.int/en/web/wipolex/)
    

## Parliamentary Activity

- [United Kingdom Parliament](https://www.parliament.uk/)
    
- [French National Assembly](https://www.assemblee-nationale.fr/)
    
- [German Bundestag](https://www.bundestag.de/en)
    
- [European Parliament](https://www.europarl.europa.eu/)
    
- [Italian Parliament](https://www.parlamento.it/)
    
- [Spanish Congress](https://www.congreso.es/)
    
- [Parliament of India](https://sansad.in/)
    
- [National Diet of Japan](https://www.shugiin.go.jp/internet/index.nsf/html/index_e.htm)
    
- [Australian Parliament](https://www.aph.gov.au/)
    
- [Parliament of Canada](https://www.parl.ca/)
    
- [Singapore Parliament](https://www.parliament.gov.sg/)
    

## Budgets and Public Finance

- [IMF Fiscal Monitor](https://www.imf.org/en/Publications/FM)
    
- [IMF Government Finance Statistics](https://data.imf.org/)
    
- [World Bank BOOST Public Expenditure Database](https://www.worldbank.org/en/programs/boost-portal)
    
- [OECD Government at a Glance](https://www.oecd.org/en/publications/government-at-a-glance_22214399.html)
    
- [European Commission Economy and Finance](https://economy-finance.ec.europa.eu/)
    
- [Eurostat Government Finance](https://ec.europa.eu/eurostat/web/government-finance-statistics/)
    
- [United Kingdom Budget and Spending](https://www.gov.uk/government/collections/budget-and-spending)
    
- [France Budget](https://www.budget.gouv.fr/)
    
- [Germany Federal Budget](https://www.bundeshaushalt.de/)
    
- [Australia Budget](https://budget.gov.au/)
    
- [Canada Budget](https://budget.canada.ca/)
    

## Procurement, Contracts and Grants

- [Open Contracting Data Registry](https://data.open-contracting.org/)
    
- [United Nations Global Marketplace](https://www.ungm.org/)
    
- [World Bank Procurement](https://projects.worldbank.org/en/projects-operations/procurement)
    
- [European Union Tenders Electronic Daily](https://ted.europa.eu/)
    
- [United Kingdom Contracts Finder](https://www.contractsfinder.service.gov.uk/)
    
- [France Public Procurement Data](https://www.data.gouv.fr/fr/datasets/donnees-essentielles-de-la-commande-publique/)
    
- [Germany Public Procurement Portal](https://www.service.bund.de/)
    
- [Italy Public Contracts Authority](https://www.anticorruzione.it/)
    
- [CanadaBuys](https://canadabuys.canada.ca/)
    
- [Australia AusTender](https://www.tenders.gov.au/)
    
- [India Government e-Marketplace](https://gem.gov.in/)
    
- [Singapore Government Procurement](https://www.gebiz.gov.sg/)
    
- [New Zealand Government Electronic Tenders](https://www.gets.govt.nz/)
    

## Sanctions and Export Controls

- [UN Security Council Consolidated Sanctions List](https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list)
    
- [European Union Sanctions Map](https://www.sanctionsmap.eu/)
    
- [EU Consolidated Financial Sanctions List](https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions)
    
- [United Kingdom Sanctions List](https://www.gov.uk/government/publications/the-uk-sanctions-list)
    
- [United Kingdom Export Control Joint Unit](https://www.gov.uk/government/organisations/export-control-joint-unit)
    
- [Germany Export Control Agency](https://www.bafa.de/EN/)
    
- [France Treasury Sanctions](https://gels-avoirs.dgtresor.gouv.fr/)
    
- [Japan Economic Sanctions](https://www.mofa.go.jp/policy/economy/)
    
- [Japan Security Export Control](https://www.meti.go.jp/policy/anpo/englishpage.html)
    
- [Australia Sanctions](https://www.dfat.gov.au/international-relations/security/sanctions)
    
- [Canada Sanctions](https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/)
    
- [Singapore Customs Strategic Goods Control](https://www.customs.gov.sg/businesses/strategic-goods-control/)
    

## Customs, Tariffs and Trade Flows

- [UN Comtrade](https://comtradeplus.un.org/)
    
- [WTO Data Portal](https://data.wto.org/)
    
- [WTO Tariff and Trade Data](https://ttd.wto.org/en)
    
- [WTO Trade Policy Measures](https://www.wto.org/english/res_e/statis_e/itip_e.htm)
    
- [World Bank World Integrated Trade Solution](https://wits.worldbank.org/)
    
- [International Trade Centre Trade Map](https://www.trademap.org/)
    
- [International Trade Centre Market Access Map](https://www.macmap.org/)
    
- [UNCTAD TRAINS](https://trainsonline.unctad.org/)
    
- [World Customs Organization](https://www.wcoomd.org/)
    
- [UN Trade and Development Statistics](https://unctadstat.unctad.org/)
    
- [EU Customs and Taxation](https://taxation-customs.ec.europa.eu/)
    
- [Eurostat International Trade](https://ec.europa.eu/eurostat/web/international-trade-in-goods/)
    

## Corporate Registries and Ownership

- [Global Legal Entity Identifier Foundation](https://www.gleif.org/)
    
- [EU Business Registers Interconnection System](https://e-justice.europa.eu/topics/registers-business-insolvency-land/business-registers-search-company-eu/)
    
- [UK Companies House Search](https://find-and-update.company-information.service.gov.uk/)
    
- [France National Business Register](https://data.inpi.fr/)
    
- [Germany Company Register](https://www.unternehmensregister.de/)
    
- [Italy Business Register](https://www.registroimprese.it/)
    
- [Netherlands Chamber of Commerce](https://www.kvk.nl/en/)
    
- [Canada Federal Corporations Search](https://ised-isde.canada.ca/cc/lgcy/fdrlCrpSrch.html)
    
- [Australian Securities and Investments Commission Registers](https://asic.gov.au/online-services/search-asic-registers/)
    
- [New Zealand Companies Register](https://companies-register.companiesoffice.govt.nz/)
    
- [Singapore Bizfile](https://www.bizfile.gov.sg/)
    
- [Hong Kong Companies Registry](https://www.cr.gov.hk/en/home/)
    
- [India Ministry of Corporate Affairs](https://www.mca.gov.in/)
    
- [Japan Corporate Number Publication Site](https://www.houjin-bangou.nta.go.jp/en/)
    

## Lobbying and Political Influence

- [EU Transparency Register](https://transparency-register.europa.eu/)
    
- [UK Register of Consultant Lobbyists](https://registrarofconsultantlobbyists.org.uk/)
    
- [UK Electoral Commission Political Finance](https://search.electoralcommission.org.uk/)
    
- [France Transparency in Public Life Authority](https://www.hatvp.fr/en/)
    
- [Germany Lobby Register](https://www.lobbyregister.bundestag.de/)
    
- [Canada Registry of Lobbyists](https://lobbycanada.gc.ca/)
    
- [Australia Register of Lobbyists](https://www.ag.gov.au/integrity/australian-government-register-lobbyists)
    

## Elections and Political Institutions

- [International IDEA](https://www.idea.int/)
    
- [International Foundation for Electoral Systems](https://www.ifes.org/)
    
- [ACE Electoral Knowledge Network](https://aceproject.org/)
    
- [European Election Database](https://european-election-database.eu/)
    
- [UK Electoral Commission](https://www.electoralcommission.org.uk/)
    
- [Elections Canada](https://www.elections.ca/)
    
- [Australian Electoral Commission](https://www.aec.gov.au/)
    
- [Election Commission of India](https://www.eci.gov.in/)
    
- [South Africa Electoral Commission](https://www.elections.org.za/)
    
- [Mexico National Electoral Institute](https://www.ine.mx/)
    

## Infrastructure and Construction

- [Global Infrastructure Hub](https://www.gihub.org/)
    
- [World Bank Infrastructure](https://www.worldbank.org/en/topic/infrastructure)
    
- [World Bank Private Participation in Infrastructure](https://ppi.worldbank.org/)
    
- [Global Infrastructure Facility](https://www.globalinfrafacility.org/)
    
- [European Investment Bank Projects](https://www.eib.org/en/projects/)
    
- [Asian Infrastructure Investment Bank Projects](https://www.aiib.org/en/projects/)
    
- [European Bank for Reconstruction and Development Projects](https://www.ebrd.com/home/what-we-do/where-we-invest.html)
    
- [OpenStreetMap](https://www.openstreetmap.org/)
    
- [Open Infrastructure Map](https://openinframap.org/)
    

## Electricity, Utilities and Energy Systems

- [International Energy Agency](https://www.iea.org/)
    
- [International Renewable Energy Agency](https://www.irena.org/)
    
- [ENTSO-E Transparency Platform](https://transparency.entsoe.eu/)
    
- [European Network of Gas Transmission Operators](https://entsog.eu/)
    
- [Eurostat Energy](https://ec.europa.eu/eurostat/web/energy/)
    
- [Global Energy Monitor](https://globalenergymonitor.org/)
    
- [International Hydropower Association](https://www.hydropower.org/)
    
- [World Nuclear Association Reactor Database](https://world-nuclear.org/)
    
- [IAEA Power Reactor Information System](https://pris.iaea.org/PRIS/)
    

## Maritime, Aviation and Logistics

- [International Maritime Organization](https://www.imo.org/)
    
- [IMO Global Integrated Shipping Information System](https://gisis.imo.org/)
    
- [Equasis Ship Database](https://www.equasis.org/)
    
- [Paris Memorandum of Understanding](https://parismou.org/)
    
- [European Maritime Safety Agency](https://www.emsa.europa.eu/)
    
- [International Civil Aviation Organization](https://www.icao.int/)
    
- [European Union Aviation Safety Agency](https://www.easa.europa.eu/)
    
- [EUROCONTROL](https://www.eurocontrol.int/)
    
- [International Transport Forum](https://www.itf-oecd.org/)
    
- [UN/LOCODE](https://unece.org/trade/cefact/unlocode-code-list-country-and-territory)
    

## Labor and Industrial Activity

- [ILOSTAT](https://ilostat.ilo.org/)
    
- [International Labour Organization](https://www.ilo.org/)
    
- [OECD Employment](https://www.oecd.org/employment/)
    
- [Eurostat Labour Market](https://ec.europa.eu/eurostat/web/labour-market/)
    
- [European Foundation for Living and Working Conditions](https://www.eurofound.europa.eu/)
    
- [UK Office for National Statistics Labour Market](https://www.ons.gov.uk/employmentandlabourmarket)
    
- [Statistics Canada Labour](https://www.statcan.gc.ca/en/subjects-start/labour_)
    
- [Australian Bureau of Statistics Labour](https://www.abs.gov.au/statistics/labour)
    

## Demographics, Migration and Displacement

- [UN Population Division](https://www.un.org/development/desa/pd/)
    
- [UN Population Fund](https://www.unfpa.org/)
    
- [International Organization for Migration](https://www.iom.int/)
    
- [Migration Data Portal](https://www.migrationdataportal.org/)
    
- [UN Refugee Agency](https://www.unhcr.org/)
    
- [Internal Displacement Monitoring Centre](https://www.internal-displacement.org/)
    
- [Eurostat Population and Demography](https://ec.europa.eu/eurostat/web/population-demography/)
    
- [OECD Migration](https://www.oecd.org/migration/)
    

## Housing, Land and Urban Development

- [UN-Habitat](https://unhabitat.org/)
    
- [World Bank Urban Development](https://www.worldbank.org/en/topic/urbandevelopment)
    
- [OECD Housing](https://www.oecd.org/housing/)
    
- [European Housing Observatory](https://www.housingeurope.eu/)
    
- [UK Land Registry](https://www.gov.uk/government/organisations/land-registry)
    
- [Netherlands Land Registry](https://www.kadaster.nl/)
    
- [Australia Property Data](https://www.abs.gov.au/statistics/people/housing)
    

## Agriculture, Food and Water

- [UN Food and Agriculture Organization](https://www.fao.org/)
    
- [FAOSTAT](https://www.fao.org/faostat/)
    
- [World Food Programme](https://www.wfp.org/)
    
- [WFP HungerMap](https://hungermap.wfp.org/)
    
- [Agricultural Market Information System](https://www.amis-outlook.org/)
    
- [International Food Policy Research Institute](https://www.ifpri.org/)
    
- [AQUASTAT Water Database](https://www.fao.org/aquastat/)
    
- [UN Water](https://www.unwater.org/)
    
- [Global Drought Observatory](https://drought.emergency.copernicus.eu/)
    

## Public Health and Pharmaceuticals

- [World Health Organization Data](https://data.who.int/)
    
- [WHO Disease Outbreak News](https://www.who.int/emergencies/disease-outbreak-news)
    
- [European Centre for Disease Prevention and Control](https://www.ecdc.europa.eu/)
    
- [Africa Centres for Disease Control](https://africacdc.org/)
    
- [European Medicines Agency](https://www.ema.europa.eu/)
    
- [Japan Pharmaceuticals and Medical Devices Agency](https://www.pmda.go.jp/english/)
    
- [Australian Therapeutic Goods Administration](https://www.tga.gov.au/)
    
- [ClinicalTrials.gov](https://clinicaltrials.gov/)
    
- [WHO International Clinical Trials Registry](https://trialsearch.who.int/)
    

## Climate, Weather and Disasters

- [World Meteorological Organization](https://wmo.int/)
    
- [Copernicus Climate Change Service](https://climate.copernicus.eu/)
    
- [Copernicus Emergency Management Service](https://emergency.copernicus.eu/)
    
- [European Centre for Medium-Range Weather Forecasts](https://www.ecmwf.int/)
    
- [Global Disaster Alert and Coordination System](https://www.gdacs.org/)
    
- [ReliefWeb](https://reliefweb.int/)
    
- [EM-DAT Disaster Database](https://www.emdat.be/)
    
- [NASA FIRMS Fire Information](https://firms.modaps.eosdis.nasa.gov/)
    
- [International Seismological Centre](https://www.isc.ac.uk/)
    
- [Global Volcanism Program](https://volcano.si.edu/)
    

## Human Rights, Corruption and Accountability

- [UN Human Rights Office](https://www.ohchr.org/)
    
- [Universal Human Rights Index](https://uhri.ohchr.org/)
    
- [UN Universal Periodic Review](https://www.ohchr.org/en/hr-bodies/upr/upr-main)
    
- [Council of Europe Anti-Corruption Group](https://www.coe.int/en/web/greco)
    
- [OECD Anti-Bribery Convention](https://www.oecd.org/corruption-integrity/explore/oecd-standards/anti-bribery-convention/)
    
- [Transparency International](https://www.transparency.org/)
    
- [International Budget Partnership](https://internationalbudget.org/)
    
- [Extractive Industries Transparency Initiative](https://eiti.org/)
    

## Information Environment and Internet Activity

- [GDELT Project](https://www.gdeltproject.org/)
    
- [Media Cloud](https://www.mediacloud.org/)
    
- [Google Trends](https://trends.google.com/)
    
- [Cloudflare Radar](https://radar.cloudflare.com/)
    
- [OONI Explorer](https://explorer.ooni.org/)
    
- [Internet Society Pulse](https://pulse.internetsociety.org/)
    
- [Internet Outage Detection and Analysis](https://ioda.inetintel.cc.gatech.edu/)
    
- [RIPEstat](https://stat.ripe.net/)
    
- [ICANN Domain Data](https://www.icann.org/resources/pages/registry-reports)
    
- [Common Crawl](https://commoncrawl.org/)
    

## Research, Patents and Standards

- [OpenAlex](https://openalex.org/)
    
- [Crossref](https://www.crossref.org/)
    
- [arXiv](https://arxiv.org/)
    
- [PubMed](https://pubmed.ncbi.nlm.nih.gov/)
    
- [CORDIS EU Research Results](https://cordis.europa.eu/)
    
- [WIPO Patentscope](https://patentscope.wipo.int/)
    
- [European Patent Office Espacenet](https://worldwide.espacenet.com/)
    
- [WIPO Lex](https://www.wipo.int/en/web/wipolex/)
    
- [International Organization for Standardization](https://www.iso.org/)
    
- [International Electrotechnical Commission](https://www.iec.ch/)
    
- [International Telecommunication Union Standards](https://www.itu.int/en/ITU-T/)
    

## Archives, Declassification and Public-Record Changes

- [UK National Archives](https://www.nationalarchives.gov.uk/)
    
- [France National Archives](https://www.archives-nationales.culture.gouv.fr/)
    
- [German Federal Archives](https://www.bundesarchiv.de/EN/)
    
- [National Archives of Japan](https://www.archives.go.jp/english/)
    
- [National Archives of Australia](https://www.naa.gov.au/)
    
- [Library and Archives Canada](https://library-archives.canada.ca/)
    
- [UK Freedom of Information Releases](https://www.gov.uk/search/transparency-and-freedom-of-information-releases)
    
- [EU Public Register of Documents](https://www.europarl.europa.eu/RegistreWeb/)
    
- [Internet Archive Wayback Machine](https://web.archive.org/)
    
- [UK Web Archive](https://www.webarchive.org.uk/)

### Europe

- [United Kingdom Ministry of Defence](https://www.gov.uk/government/organisations/ministry-of-defence)
    
- [France Ministry of the Armed Forces](https://www.defense.gouv.fr/)
    
- [Germany Federal Ministry of Defence](https://www.bmvg.de/en)
    
- [Italy Ministry of Defence](https://www.difesa.it/eng/)
    
- [Spain Ministry of Defence](https://www.defensa.gob.es/)
    
- [Netherlands Ministry of Defence](https://english.defensie.nl/)
    
- [Belgian Defence](https://www.mil.be/en/)
    
- [Denmark Ministry of Defence](https://www.fmn.dk/en/)
    
- [Norway Ministry of Defence](https://www.regjeringen.no/en/dep/fd/id380/)
    
- [Sweden Ministry of Defence](https://www.government.se/government-of-sweden/ministry-of-defence/)
    
- [Finland Ministry of Defence](https://www.defmin.fi/en)
    
- [Poland Ministry of National Defence](https://www.gov.pl/web/national-defence)
    
- [Estonia Ministry of Defence](https://kaitseministeerium.ee/en)
    
- [Ukraine Ministry of Defence](https://mod.gov.ua/en)
    
- [Türkiye Ministry of National Defence](https://www.msb.gov.tr/En)
    

### Asia–Pacific

- [Japan Ministry of Defense](https://www.mod.go.jp/en/)
    
- [South Korea Ministry of National Defense](https://www.mnd.go.kr/mbshome/mbs/mndEN/)
    
- [China Ministry of National Defense](http://eng.mod.gov.cn/)
    
- [Taiwan Ministry of National Defense](https://www.mnd.gov.tw/English/)
    
- [India Ministry of Defence](https://www.mod.gov.in/)
    
- [Singapore Ministry of Defence](https://www.mindef.gov.sg/)
    
- [Australia Department of Defence](https://www.defence.gov.au/)
    
- [New Zealand Defence Force](https://www.nzdf.mil.nz/)
    
- [Philippines Department of National Defense](https://www.dnd.gov.ph/)
    
- [Pakistan Ministry of Defence](https://mod.gov.pk/)
    
- [Indonesia Ministry of Defense](https://www.kemhan.go.id/)
    

### Middle East

- [Israel Ministry of Defense](https://www.mod.gov.il/en/)
    
- [United Arab Emirates Ministry of Defence](https://mod.gov.ae/)
    
- [Saudi Arabia Ministry of Defense](https://www.mod.gov.sa/)
    

### Americas and Africa

- [Canada Department of National Defence](https://www.canada.ca/en/department-national-defence.html)
    
- [Brazil Ministry of Defence](https://www.gov.br/defesa/pt-br)
    
- [South African Department of Defence](https://www.dod.mil.za/)


### Europe

- [United Kingdom Police](https://www.police.uk/)
    
- [United Kingdom National Crime Agency](https://www.nationalcrimeagency.gov.uk/)
    
- [France National Police](https://www.police-nationale.interieur.gouv.fr/)
    
- [France Ma Sécurité](https://www.masecurite.interieur.gouv.fr/en)
    
- [Germany Federal Criminal Police Office](https://www.bka.de/EN/)
    
- [Italy State Police](https://www.poliziadistato.it/)
    
- [Spain National Police](https://www.policia.es/)
    
- [Netherlands Police](https://www.politie.nl/en)
    
- [Belgian Federal Police](https://www.police.be/5998/en)
    
- [Swedish Police](https://polisen.se/en/)
    
- [Norwegian Police](https://www.politiet.no/en/)
    
- [Finnish Police](https://poliisi.fi/en)
    
- [Danish Police](https://politi.dk/)
    
- [Polish National Police](https://policja.pl/)
    
- [Estonian Police and Border Guard Board](https://www.politsei.ee/en)
    
- [Ukraine National Police](https://npu.gov.ua/en)
    

### Asia–Pacific

- [Japan National Police Agency](https://www.npa.go.jp/english/)
    
- [South Korea National Police Agency](https://www.police.go.kr/eng/)
    
- [India National Crime Records Bureau](https://www.ncrb.gov.in/)
    
- [Singapore Police Force](https://www.police.gov.sg/)
    
- [Hong Kong Police Force](https://www.police.gov.hk/ppp_en/)
    
- [Taiwan National Police Agency](https://www.npa.gov.tw/en/)
    
- [Philippine National Police](https://pnp.gov.ph/)
    
- [Australia Federal Police](https://www.afp.gov.au/)
    
- [New Zealand Police](https://www.police.govt.nz/)
    

### Middle East

- [Israel Police](https://www.gov.il/en/departments/israel_police/govil-landing-page)
    
- [United Arab Emirates Ministry of Interior](https://moi.gov.ae/en/)
    
- [Saudi Arabia Ministry of Interior](https://www.moi.gov.sa/)
    

### Americas

- [Royal Canadian Mounted Police](https://rcmp.ca/en)
    
- [Mexico Secretariat of Security and Citizen Protection](https://www.gob.mx/sspc)
    
- [Brazil Federal Police](https://www.gov.br/pf/pt-br)
    
- [Argentina Federal Police](https://www.argentina.gob.ar/policia-federal-argentina)
    
- [Chile Investigations Police](https://www.pdichile.cl/)
    

### Africa

- [South African Police Service](https://www.saps.gov.za/)
    
- [Kenya National Police Service](https://www.nationalpolice.go.ke/)
    
- [Nigeria Police Force](https://www.npf.gov.ng/)
    
- [Ghana Police Service](https://police.gov.gh/)
    

### International

- [INTERPOL](https://www.interpol.int/)
    
- [Europol](https://www.europol.europa.eu/)
    
- [United Nations Office on Drugs and Crime](https://www.unodc.org/)


### Europe

- [United Kingdom HM Treasury](https://www.gov.uk/government/organisations/hm-treasury)
    
- [Bank of England](https://www.bankofengland.co.uk/)
    
- [UK Financial Conduct Authority](https://www.fca.org.uk/)
    
- [France Ministry of Economics and Finance](https://www.economie.gouv.fr/)
    
- [Banque de France](https://www.banque-france.fr/en)
    
- [France Financial Markets Authority](https://www.amf-france.org/en)
    
- [Germany Federal Ministry of Finance](https://www.bundesfinanzministerium.de/)
    
- [Deutsche Bundesbank](https://www.bundesbank.de/en)
    
- [Germany BaFin](https://www.bafin.de/EN/)
    
- [Italy Ministry of Economy and Finance](https://www.mef.gov.it/en/)
    
- [Bank of Italy](https://www.bancaditalia.it/?com.dotmarketing.htmlpage.language=1)
    
- [Spain Ministry of Economy](https://portal.mineco.gob.es/en-us/)
    
- [Bank of Spain](https://www.bde.es/wbe/en/)
    
- [Netherlands Ministry of Finance](https://www.government.nl/ministries/ministry-of-finance)
    
- [De Nederlandsche Bank](https://www.dnb.nl/en/)
    
- [Swiss Federal Department of Finance](https://www.efd.admin.ch/en)
    
- [Swiss National Bank](https://www.snb.ch/en/)
    
- [Swedish Ministry of Finance](https://www.government.se/government-of-sweden/ministry-of-finance/)
    
- [Sveriges Riksbank](https://www.riksbank.se/en-gb/)
    
- [Norway Ministry of Finance](https://www.regjeringen.no/en/dep/fin/id216/)
    
- [Norges Bank](https://www.norges-bank.no/en/)
    
- [Poland Ministry of Finance](https://www.gov.pl/web/finance)
    
- [National Bank of Poland](https://nbp.pl/en/)
    
- [Ukraine Ministry of Finance](https://mof.gov.ua/en)
    
- [National Bank of Ukraine](https://bank.gov.ua/en/)
    

### European Institutions

- [European Central Bank](https://www.ecb.europa.eu/)
    
- [European Banking Authority](https://www.eba.europa.eu/)
    
- [European Securities and Markets Authority](https://www.esma.europa.eu/)
    
- [European Insurance and Occupational Pensions Authority](https://www.eiopa.europa.eu/)
    

### Asia–Pacific

- [Japan Ministry of Finance](https://www.mof.go.jp/english/)
    
- [Bank of Japan](https://www.boj.or.jp/en/)
    
- [Japan Financial Services Agency](https://www.fsa.go.jp/en/)
    
- [China Ministry of Finance](https://www.mof.gov.cn/en/)
    
- [People’s Bank of China](http://www.pbc.gov.cn/en/)
    
- [China Securities Regulatory Commission](http://www.csrc.gov.cn/csrc_en/)
    
- [India Ministry of Finance](https://www.finmin.gov.in/)
    
- [Reserve Bank of India](https://www.rbi.org.in/)
    
- [Securities and Exchange Board of India](https://www.sebi.gov.in/)
    
- [South Korea Ministry of Economy and Finance](https://english.moef.go.kr/)
    
- [Bank of Korea](https://www.bok.or.kr/eng/)
    
- [South Korea Financial Services Commission](https://www.fsc.go.kr/eng/)
    
- [Singapore Ministry of Finance](https://www.mof.gov.sg/)
    
- [Monetary Authority of Singapore](https://www.mas.gov.sg/)
    
- [Hong Kong Financial Services and Treasury Bureau](https://www.fstb.gov.hk/)
    
- [Hong Kong Monetary Authority](https://www.hkma.gov.hk/eng/)
    
- [Australia Treasury](https://treasury.gov.au/)
    
- [Reserve Bank of Australia](https://www.rba.gov.au/)
    
- [Australian Securities and Investments Commission](https://asic.gov.au/)
    
- [New Zealand Treasury](https://www.treasury.govt.nz/)
    
- [Reserve Bank of New Zealand](https://www.rbnz.govt.nz/)
    
- [Indonesia Ministry of Finance](https://www.kemenkeu.go.id/en)
    
- [Bank Indonesia](https://www.bi.go.id/en/)
    
- [Philippines Department of Finance](https://www.dof.gov.ph/)
    
- [Bangko Sentral ng Pilipinas](https://www.bsp.gov.ph/)
    

### Middle East

- [Israel Ministry of Finance](https://www.gov.il/en/departments/ministry_of_finance/)
    
- [Bank of Israel](https://www.boi.org.il/en/)
    
- [United Arab Emirates Ministry of Finance](https://mof.gov.ae/)
    
- [Central Bank of the UAE](https://www.centralbank.ae/en/)
    
- [Saudi Arabia Ministry of Finance](https://www.mof.gov.sa/en/)
    
- [Saudi Central Bank](https://www.sama.gov.sa/en-US/)
    
- [Qatar Ministry of Finance](https://www.mof.gov.qa/en/)
    
- [Qatar Central Bank](https://www.qcb.gov.qa/en/)
    
- [Türkiye Ministry of Treasury and Finance](https://www.hmb.gov.tr/)
    
- [Central Bank of Türkiye](https://www.tcmb.gov.tr/wps/wcm/connect/en/tcmb+en)
    

### Americas

- [Canada Department of Finance](https://www.canada.ca/en/department-finance.html)
    
- [Bank of Canada](https://www.bankofcanada.ca/)
    
- [Brazil Ministry of Finance](https://www.gov.br/fazenda/pt-br)
    
- [Central Bank of Brazil](https://www.bcb.gov.br/en)
    
- [Mexico Secretariat of Finance and Public Credit](https://www.gob.mx/shcp)
    
- [Bank of Mexico](https://www.banxico.org.mx/indexen.html)
    
- [Argentina Ministry of Economy](https://www.argentina.gob.ar/economia)
    
- [Central Bank of Argentina](https://www.bcra.gob.ar/)
    

### Africa

- [South Africa National Treasury](https://www.treasury.gov.za/)
    
- [South African Reserve Bank](https://www.resbank.co.za/)
    
- [Nigeria Federal Ministry of Finance](https://finance.gov.ng/)
    
- [Central Bank of Nigeria](https://www.cbn.gov.ng/)
    
- [Kenya National Treasury](https://www.treasury.go.ke/)
    
- [Central Bank of Kenya](https://www.centralbank.go.ke/)
    
- [Ghana Ministry of Finance](https://mofep.gov.gh/)
    
- [Bank of Ghana](https://www.bog.gov.gh/)
    

### International Finance

- [International Monetary Fund](https://www.imf.org/)
    
- [World Bank](https://www.worldbank.org/)
    
- [Bank for International Settlements](https://www.bis.org/)
    
- [Financial Stability Board](https://www.fsb.org/)
    
- [OECD Finance](https://www.oecd.org/finance/)
    
- [FATF](https://www.fatf-gafi.org/)


### Europe

- [United Kingdom Ministry of Justice](https://www.gov.uk/government/organisations/ministry-of-justice)
    
- [Courts and Tribunals Judiciary](https://www.judiciary.uk/)
    
- [UK Supreme Court](https://www.supremecourt.uk/)
    
- [France Ministry of Justice](https://www.justice.gouv.fr/)
    
- [France Court of Cassation](https://www.courdecassation.fr/)
    
- [Germany Federal Ministry of Justice](https://www.bmjv.de/EN/)
    
- [Germany Federal Court of Justice](https://www.bundesgerichtshof.de/)
    
- [Italy Ministry of Justice](https://www.giustizia.it/giustizia/en/)
    
- [Italy Constitutional Court](https://www.cortecostituzionale.it/)
    
- [Spain Ministry of Justice](https://www.mjusticia.gob.es/en)
    
- [Spain General Council of the Judiciary](https://www.poderjudicial.es/)
    
- [Netherlands Ministry of Justice and Security](https://www.government.nl/ministries/ministry-of-justice-and-security)
    
- [Netherlands Judiciary](https://www.rechtspraak.nl/English)
    
- [Belgium Federal Public Service Justice](https://justice.belgium.be/en)
    
- [Sweden Ministry of Justice](https://www.government.se/government-of-sweden/ministry-of-justice/)
    
- [Swedish Courts](https://www.domstol.se/)
    
- [Norway Ministry of Justice](https://www.regjeringen.no/en/dep/jd/id463/)
    
- [Norwegian Courts](https://www.domstol.no/en/)
    
- [Finland Ministry of Justice](https://oikeusministerio.fi/en/frontpage)
    
- [Finland Judicial Administration](https://oikeus.fi/en/)
    
- [Poland Ministry of Justice](https://www.gov.pl/web/justice)
    
- [Poland Supreme Court](https://www.sn.pl/english/)
    
- [Estonia Ministry of Justice and Digital Affairs](https://www.justdigi.ee/en)
    
- [Estonian Courts](https://www.kohus.ee/en)
    
- [Ukraine Ministry of Justice](https://minjust.gov.ua/en)
    
- [Judiciary of Ukraine](https://court.gov.ua/eng/)
    

### European Institutions

- [European e-Justice Portal](https://e-justice.europa.eu/)
    
- [Court of Justice of the European Union](https://curia.europa.eu/)
    
- [European Court of Human Rights](https://www.echr.coe.int/)
    

### Asia–Pacific

- [Japan Ministry of Justice](https://www.moj.go.jp/EN/)
    
- [Supreme Court of Japan](https://www.courts.go.jp/english/)
    
- [South Korea Ministry of Justice](https://www.moj.go.kr/moj_eng/)
    
- [Supreme Court of Korea](https://eng.scourt.go.kr/)
    
- [China Ministry of Justice](http://en.moj.gov.cn/)
    
- [Supreme People’s Court of China](https://english.court.gov.cn/)
    
- [India Department of Justice](https://doj.gov.in/)
    
- [Supreme Court of India](https://www.sci.gov.in/)
    
- [Singapore Ministry of Law](https://www.mlaw.gov.sg/)
    
- [Singapore Judiciary](https://www.judiciary.gov.sg/)
    
- [Hong Kong Department of Justice](https://www.doj.gov.hk/en/)
    
- [Hong Kong Judiciary](https://www.judiciary.hk/en/home/)
    
- [Taiwan Ministry of Justice](https://www.moj.gov.tw/EN/)
    
- [Judicial Yuan of Taiwan](https://www.judicial.gov.tw/en/)
    
- [Australia Attorney-General’s Department](https://www.ag.gov.au/)
    
- [High Court of Australia](https://www.hcourt.gov.au/)
    
- [New Zealand Ministry of Justice](https://www.justice.govt.nz/)
    
- [Courts of New Zealand](https://www.courtsofnz.govt.nz/)
    
- [Philippines Department of Justice](https://www.doj.gov.ph/)
    
- [Supreme Court of the Philippines](https://sc.judiciary.gov.ph/)
    
- [Supreme Court of Indonesia](https://www.mahkamahagung.go.id/en)
    

### Middle East

- [Israel Ministry of Justice](https://www.gov.il/en/departments/ministry_of_justice/)
    
- [Israel Judicial Authority](https://www.gov.il/en/departments/the_judicial_authority/)
    
- [United Arab Emirates Ministry of Justice](https://www.moj.gov.ae/en/)
    
- [Saudi Arabia Ministry of Justice](https://www.moj.gov.sa/English/)
    
- [Qatar Ministry of Justice](https://www.moj.gov.qa/en/)
    

### Americas

- [Canada Department of Justice](https://www.justice.gc.ca/eng/)
    
- [Supreme Court of Canada](https://www.scc-csc.ca/)
    
- [Brazil Ministry of Justice and Public Security](https://www.gov.br/mj/pt-br)
    
- [Brazil Supreme Federal Court](https://portal.stf.jus.br/)
    
- [Mexico Supreme Court of Justice](https://www.scjn.gob.mx/)
    
- [Mexico Federal Judiciary Council](https://www.cjf.gob.mx/)
    
- [Argentina Ministry of Justice](https://www.argentina.gob.ar/justicia)
    
- [Supreme Court of Argentina](https://www.csjn.gov.ar/)
    
- [Chile Ministry of Justice and Human Rights](https://www.minjusticia.gob.cl/)
    
- [Judiciary of Chile](https://www.pjud.cl/)
    

### Africa

- [South Africa Department of Justice](https://www.justice.gov.za/)
    
- [South African Judiciary](https://www.judiciary.org.za/)
    
- [Kenya Judiciary](https://judiciary.go.ke/)
    
- [Kenya Office of the Attorney General](https://www.statelaw.go.ke/)
    
- [Nigeria Federal Ministry of Justice](https://justice.gov.ng/)
    
- [Supreme Court of Nigeria](https://supremecourt.gov.ng/)
    
- [Ghana Ministry of Justice and Attorney-General](https://mojagd.gov.gh/)
    
- [Judicial Service of Ghana](https://judicial.gov.gh/)
    

### International Justice

- [International Court of Justice](https://www.icj-cij.org/)
    
- [International Criminal Court](https://www.icc-cpi.int/)
    
- [Permanent Court of Arbitration](https://pca-cpa.org/)
    
- [Hague Conference on Private International Law](https://www.hcch.net/)


### Europe

- [United Kingdom Department for Business and Trade](https://www.gov.uk/government/organisations/department-for-business-and-trade)
    
- [UK Business and Trade](https://www.business.gov.uk/)
    
- [UK Companies House](https://www.gov.uk/government/organisations/companies-house)
    
- [UK Office for National Statistics](https://www.ons.gov.uk/)
    
- [France Ministry of Economy](https://www.economie.gouv.fr/)
    
- [France Directorate-General for Enterprise](https://www.entreprises.gouv.fr/)
    
- [Business France](https://www.businessfrance.fr/en)
    
- [France National Institute of Statistics](https://www.insee.fr/en/)
    
- [Germany Federal Ministry for Economic Affairs](https://www.bundeswirtschaftsministerium.de/)
    
- [Germany Trade and Invest](https://www.gtai.de/en/)
    
- [Germany Federal Statistical Office](https://www.destatis.de/EN/)
    
- [Italy Ministry of Enterprises and Made in Italy](https://www.mimit.gov.it/en/)
    
- [Italian Trade Agency](https://www.ice.it/en/)
    
- [Italy National Institute of Statistics](https://www.istat.it/en/)
    
- [Spain Ministry of Economy](https://portal.mineco.gob.es/en-us/)
    
- [ICEX Spain Trade and Investment](https://www.investinspain.org/)
    
- [Spain National Statistics Institute](https://www.ine.es/en/)
    
- [Netherlands Business Portal](https://business.gov.nl/)
    
- [Netherlands Chamber of Commerce](https://www.kvk.nl/en/)
    
- [Statistics Netherlands](https://www.cbs.nl/en-gb)
    
- [Switzerland State Secretariat for Economic Affairs](https://www.seco.admin.ch/seco/en/home.html)
    
- [Switzerland Global Enterprise](https://www.s-ge.com/en)
    
- [Swiss Federal Statistical Office](https://www.bfs.admin.ch/bfs/en/home.html)
    
- [Sweden Ministry of Climate and Enterprise](https://www.government.se/government-of-sweden/ministry-of-climate-and-enterprise/)
    
- [Business Sweden](https://www.business-sweden.com/)
    
- [Statistics Sweden](https://www.scb.se/en/)
    
- [Norway Ministry of Trade, Industry and Fisheries](https://www.regjeringen.no/en/dep/nfd/id709/)
    
- [Innovation Norway](https://www.innovasjonnorge.no/en/)
    
- [Statistics Norway](https://www.ssb.no/en)
    
- [Finland Ministry of Economic Affairs and Employment](https://tem.fi/en/frontpage)
    
- [Business Finland](https://www.businessfinland.com/)
    
- [Statistics Finland](https://stat.fi/en/)
    
- [Poland Ministry of Economic Development](https://www.gov.pl/web/development-technology)
    
- [Polish Investment and Trade Agency](https://www.paih.gov.pl/en/)
    
- [Statistics Poland](https://stat.gov.pl/en/)
    
- [Ukraine Ministry of Economy](https://me.gov.ua/?lang=en-GB)
    
- [UkraineInvest](https://ukraineinvest.gov.ua/en/)
    
- [State Statistics Service of Ukraine](https://www.ukrstat.gov.ua/)
    

### European Institutions

- [European Commission Internal Market and Industry](https://single-market-economy.ec.europa.eu/)
    
- [European Commission Trade](https://policy.trade.ec.europa.eu/)
    
- [Eurostat](https://ec.europa.eu/eurostat/)
    
- [European Business Register](https://ebra.be/)
    
- [EU Funding and Tenders Portal](https://ec.europa.eu/info/funding-tenders/opportunities/portal/)
    

### Asia–Pacific

- [Japan Ministry of Economy, Trade and Industry](https://www.meti.go.jp/english/)
    
- [Japan External Trade Organization](https://www.jetro.go.jp/en/)
    
- [Japan Statistics Bureau](https://www.stat.go.jp/english/)
    
- [China Ministry of Commerce](http://english.mofcom.gov.cn/)
    
- [China National Bureau of Statistics](https://www.stats.gov.cn/english/)
    
- [China State Administration for Market Regulation](https://www.samr.gov.cn/)
    
- [India Ministry of Commerce and Industry](https://www.commerce.gov.in/)
    
- [Invest India](https://www.investindia.gov.in/)
    
- [India Ministry of Statistics](https://www.mospi.gov.in/)
    
- [South Korea Ministry of Trade, Industry and Energy](https://english.motie.go.kr/)
    
- [Korea Trade-Investment Promotion Agency](https://www.kotra.or.kr/english/)
    
- [Statistics Korea](https://kostat.go.kr/anse/)
    
- [Singapore Ministry of Trade and Industry](https://www.mti.gov.sg/)
    
- [Enterprise Singapore](https://www.enterprisesg.gov.sg/)
    
- [Accounting and Corporate Regulatory Authority](https://www.acra.gov.sg/)
    
- [Singapore Department of Statistics](https://www.singstat.gov.sg/)
    
- [Hong Kong Commerce and Economic Development Bureau](https://www.cedb.gov.hk/en/)
    
- [Invest Hong Kong](https://www.investhk.gov.hk/)
    
- [Hong Kong Companies Registry](https://www.cr.gov.hk/en/home/)
    
- [Hong Kong Census and Statistics Department](https://www.censtatd.gov.hk/en/)
    
- [Taiwan Ministry of Economic Affairs](https://www.moea.gov.tw/Mns/english/)
    
- [Invest Taiwan](https://investtaiwan.nat.gov.tw/)
    
- [Australia Department of Industry](https://www.industry.gov.au/)
    
- [Australian Trade and Investment Commission](https://www.austrade.gov.au/)
    
- [Australian Bureau of Statistics](https://www.abs.gov.au/)
    
- [New Zealand Ministry of Business, Innovation and Employment](https://www.mbie.govt.nz/)
    
- [New Zealand Trade and Enterprise](https://www.nzte.govt.nz/)
    
- [Stats NZ](https://www.stats.govt.nz/)
    
- [Indonesia Ministry of Trade](https://www.kemendag.go.id/)
    
- [Indonesia Investment Coordinating Board](https://www.investindonesia.go.id/)
    
- [Statistics Indonesia](https://www.bps.go.id/en)
    
- [Philippines Department of Trade and Industry](https://www.dti.gov.ph/)
    
- [Philippine Board of Investments](https://boi.gov.ph/)
    
- [Philippine Statistics Authority](https://psa.gov.ph/)
    

### Middle East

- [Israel Ministry of Economy and Industry](https://www.gov.il/en/departments/ministry_of_economy/)
    
- [Israel Investment Promotion Center](https://investinisrael.gov.il/)
    
- [Israel Central Bureau of Statistics](https://www.cbs.gov.il/en/)
    
- [UAE Ministry of Economy](https://www.moec.gov.ae/en/)
    
- [Invest in the UAE](https://invest.ae/)
    
- [UAE Federal Competitiveness and Statistics Centre](https://fcsc.gov.ae/en-us/)
    
- [Saudi Ministry of Commerce](https://mc.gov.sa/en/)
    
- [Invest Saudi](https://investsaudi.sa/en/)
    
- [Saudi General Authority for Statistics](https://www.stats.gov.sa/en)
    
- [Qatar Ministry of Commerce and Industry](https://www.moci.gov.qa/en/)
    
- [Invest Qatar](https://www.invest.qa/)
    
- [Qatar Planning and Statistics Authority](https://www.psa.gov.qa/en/)
    
- [Türkiye Ministry of Trade](https://www.trade.gov.tr/)
    
- [Invest in Türkiye](https://www.invest.gov.tr/en/)
    
- [Turkish Statistical Institute](https://www.turkstat.gov.tr/)
    

### Americas

- [Canada Innovation, Science and Economic Development](https://ised-isde.canada.ca/)
    
- [Invest in Canada](https://www.investcanada.ca/)
    
- [Statistics Canada](https://www.statcan.gc.ca/en/start)
    
- [Brazil Ministry of Development, Industry and Trade](https://www.gov.br/mdic/pt-br)
    
- [Invest in Brasil](https://www.investinbrasil.com.br/)
    
- [Brazilian Institute of Geography and Statistics](https://www.ibge.gov.br/en/)
    
- [Mexico Secretariat of Economy](https://www.gob.mx/se)
    
- [Mexico National Institute of Statistics](https://www.inegi.org.mx/)
    
- [Argentina Ministry of Economy](https://www.argentina.gob.ar/economia)
    
- [Invest Argentina](https://www.investargentina.org.ar/)
    
- [Argentina National Institute of Statistics](https://www.indec.gob.ar/)
    
- [Chile Ministry of Economy](https://www.economia.gob.cl/)
    
- [InvestChile](https://www.investchile.gob.cl/)
    
- [Chile National Statistics Institute](https://www.ine.gob.cl/)
    

### Africa

- [South Africa Department of Trade, Industry and Competition](https://www.thedtic.gov.za/)
    
- [Invest South Africa](https://www.investsa.gov.za/)
    
- [Statistics South Africa](https://www.statssa.gov.za/)
    
- [Nigeria Federal Ministry of Industry, Trade and Investment](https://fmiti.gov.ng/)
    
- [Nigerian Investment Promotion Commission](https://www.nipc.gov.ng/)
    
- [Nigeria National Bureau of Statistics](https://www.nigerianstat.gov.ng/)
    
- [Kenya Ministry of Investments, Trade and Industry](https://www.investmentpromotion.go.ke/)
    
- [KenInvest](https://www.invest.go.ke/)
    
- [Kenya National Bureau of Statistics](https://www.knbs.or.ke/)
    
- [Ghana Ministry of Trade and Industry](https://moti.gov.gh/)
    
- [Ghana Investment Promotion Centre](https://www.gipc.gov.gh/)
    
- [Ghana Statistical Service](https://statsghana.gov.gh/)
    

### International Business and Economy

- [World Trade Organization](https://www.wto.org/)
    
- [OECD Economy](https://www.oecd.org/economy/)
    
- [World Bank Data](https://data.worldbank.org/)
    
- [UN Trade and Development](https://unctad.org/)
    
- [International Trade Centre](https://www.intracen.org/)
    
- [UN Industrial Development Organization](https://www.unido.org/)
    
- [World Intellectual Property Organization](https://www.wipo.int/)
    
- [Global Trade Helpdesk](https://globaltradehelpdesk.org/)


## United Kingdom

- [Department for Science, Innovation and Technology](https://www.gov.uk/government/organisations/department-for-science-innovation-and-technology)
    
- [UK Research and Innovation](https://www.ukri.org/)
    
- [Engineering and Physical Sciences Research Council](https://www.ukri.org/councils/epsrc/)
    
- [Biotechnology and Biological Sciences Research Council](https://www.ukri.org/councils/bbsrc/)
    
- [Medical Research Council](https://www.ukri.org/councils/mrc/)
    
- [Natural Environment Research Council](https://www.ukri.org/councils/nerc/)
    
- [Science and Technology Facilities Council](https://www.ukri.org/councils/stfc/)
    
- [UK Atomic Energy Authority](https://www.gov.uk/government/organisations/uk-atomic-energy-authority)
    
- [UK Space Agency](https://www.gov.uk/government/organisations/uk-space-agency)
    
- [National Physical Laboratory](https://www.npl.co.uk/)
    

## France

- [National Centre for Scientific Research — CNRS](https://www.cnrs.fr/en)
    
- [French Alternative Energies and Atomic Energy Commission — CEA](https://www.cea.fr/english)
    
- [French National Research Agency](https://anr.fr/en/)
    
- [National Institute of Health and Medical Research — Inserm](https://www.inserm.fr/en/)
    
- [French National Institute for Agriculture, Food and Environment](https://www.inrae.fr/en)
    
- [French Space Agency — CNES](https://cnes.fr/en)
    
- [French Institute of Petroleum and New Energies](https://www.ifpenergiesnouvelles.com/)
    
- [French National Synchrotron — SOLEIL](https://www.synchrotron-soleil.fr/en)
    

## Germany

- [German Research Foundation](https://www.dfg.de/en)
    
- [Max Planck Society](https://www.mpg.de/en)
    
- [Helmholtz Association](https://www.helmholtz.de/en/)
    
- [Fraunhofer Society](https://www.fraunhofer.de/en.html)
    
- [Leibniz Association](https://www.leibniz-gemeinschaft.de/en/)
    
- [German Aerospace Center](https://www.dlr.de/en/)
    
- [Forschungszentrum Jülich](https://www.fz-juelich.de/en)
    
- [Karlsruhe Institute of Technology](https://www.kit.edu/english/)
    
- [Max Planck Institute for Plasma Physics](https://www.ipp.mpg.de/en)
    

## Italy

- [National Research Council of Italy](https://www.cnr.it/en)
    
- [Italian National Agency for New Technologies and Energy](https://www.enea.it/en/)
    
- [Italian National Institute for Nuclear Physics](https://www.infn.it/en/)
    
- [Italian Space Agency](https://www.asi.it/en/)
    
- [National Institute for Astrophysics](https://www.inaf.it/en)
    
- [Italian Institute of Technology](https://www.iit.it/)
    

## Spain

- [Spanish National Research Council](https://www.csic.es/en)
    
- [Centre for Energy, Environment and Technology Research](https://www.ciemat.es/)
    
- [Centre for Industrial Technological Development](https://www.cdti.es/)
    
- [Spanish State Research Agency](https://www.aei.gob.es/en)
    
- [Spanish Space Agency](https://www.aee.gob.es/)
    

## Netherlands

- [Dutch Research Council](https://www.nwo.nl/en)
    
- [Netherlands Organisation for Applied Scientific Research](https://www.tno.nl/en/)
    
- [National Institute for Public Health and the Environment](https://www.rivm.nl/en)
    
- [Netherlands Institute for Space Research](https://www.sron.nl/)
    
- [Royal Netherlands Academy of Arts and Sciences](https://www.knaw.nl/en)
    

## Switzerland

- [Swiss National Science Foundation](https://www.snf.ch/en)
    
- [ETH Domain](https://ethrat.ch/en/)
    
- [Paul Scherrer Institute](https://www.psi.ch/en)
    
- [Swiss Federal Laboratories for Materials Science](https://www.empa.ch/)
    
- [Swiss Space Office](https://www.sbfi.admin.ch/en/space-affairs)
    

## Nordic Countries

- [Swedish Research Council](https://www.vr.se/english.html)
    
- [Swedish Energy Agency](https://www.energimyndigheten.se/en/)
    
- [Swedish National Space Agency](https://www.rymdstyrelsen.se/en/)
    
- [Research Council of Norway](https://www.forskningsradet.no/en/)
    
- [Institute for Energy Technology Norway](https://ife.no/en/)
    
- [Norwegian Space Agency](https://romsenter.no/en/)
    
- [Research Council of Finland](https://www.aka.fi/en/)
    
- [VTT Technical Research Centre of Finland](https://www.vttresearch.com/en)
    
- [Business Finland Research and Innovation](https://www.businessfinland.fi/en/)
    
- [Innovation Fund Denmark](https://innovationsfonden.dk/en)
    
- [Technical University of Denmark Research](https://www.dtu.dk/english)
    

## Japan

- [Ministry of Education, Culture, Sports, Science and Technology](https://www.mext.go.jp/en/)
    
- [Japan Science and Technology Agency](https://www.jst.go.jp/EN/)
    
- [RIKEN](https://www.riken.jp/en/)
    
- [National Institute of Advanced Industrial Science and Technology](https://www.aist.go.jp/index_en.html)
    
- [Japan Atomic Energy Agency](https://www.jaea.go.jp/english/)
    
- [Japan Aerospace Exploration Agency](https://global.jaxa.jp/)
    
- [National Institute for Materials Science](https://www.nims.go.jp/eng/)
    
- [Japan Agency for Marine-Earth Science and Technology](https://www.jamstec.go.jp/e/)
    
- [National Institute for Earth Science and Disaster Resilience](https://www.bosai.go.jp/e/)
    

## China

- [Ministry of Science and Technology](https://en.most.gov.cn/)
    
- [Chinese Academy of Sciences](https://english.cas.cn/)
    
- [National Natural Science Foundation of China](https://www.nsfc.gov.cn/english/site_1/)
    
- [China National Space Administration](https://www.cnsa.gov.cn/english/)
    
- [China Atomic Energy Authority](https://www.caea.gov.cn/english/)
    
- [Chinese Academy of Engineering](https://en.cae.cn/)
    
- [National Energy Administration](https://www.nea.gov.cn/)
    

## India

- [Department of Science and Technology](https://dst.gov.in/)
    
- [Council of Scientific and Industrial Research](https://www.csir.res.in/)
    
- [Department of Biotechnology](https://dbtindia.gov.in/)
    
- [Department of Atomic Energy](https://dae.gov.in/)
    
- [Indian Space Research Organisation](https://www.isro.gov.in/)
    
- [Department of Scientific and Industrial Research](https://dsir.gov.in/)
    
- [Ministry of Earth Sciences](https://moes.gov.in/)
    
- [Indian Council of Medical Research](https://www.icmr.gov.in/)
    
- [India Meteorological Department](https://mausam.imd.gov.in/)
    

## South Korea

- [Ministry of Science and ICT](https://www.msit.go.kr/eng/)
    
- [National Research Foundation of Korea](https://www.nrf.re.kr/eng/)
    
- [Korea Institute of Science and Technology](https://www.kist.re.kr/eng/)
    
- [Korea Atomic Energy Research Institute](https://www.kaeri.re.kr/eng/)
    
- [Korea Aerospace Research Institute](https://www.kari.re.kr/eng.do)
    
- [Korea Institute of Energy Research](https://www.kier.re.kr/eng)
    
- [Korea Research Institute of Chemical Technology](https://www.krict.re.kr/eng/)
    
- [Korea Research Institute of Bioscience and Biotechnology](https://www.kribb.re.kr/eng/)
    

## Singapore

- [National Research Foundation Singapore](https://www.nrf.gov.sg/)
    
- [Agency for Science, Technology and Research](https://www.a-star.edu.sg/)
    
- [Energy Market Authority](https://www.ema.gov.sg/)
    
- [National Environment Agency](https://www.nea.gov.sg/)
    
- [Health Sciences Authority](https://www.hsa.gov.sg/)
    

## Australia

- [Department of Industry, Science and Resources](https://www.industry.gov.au/)
    
- [Commonwealth Scientific and Industrial Research Organisation](https://www.csiro.au/)
    
- [Australian Research Council](https://www.arc.gov.au/)
    
- [Australian Nuclear Science and Technology Organisation](https://www.ansto.gov.au/)
    
- [Australian Space Agency](https://www.space.gov.au/)
    
- [Geoscience Australia](https://www.ga.gov.au/)
    
- [Australian Institute of Marine Science](https://www.aims.gov.au/)
    
- [Bureau of Meteorology](https://www.bom.gov.au/)
    

## New Zealand

- [Ministry of Business, Innovation and Employment](https://www.mbie.govt.nz/)
    
- [Royal Society Te Apārangi](https://www.royalsociety.org.nz/)
    
- [GNS Science](https://www.gns.cri.nz/)
    
- [National Institute of Water and Atmospheric Research](https://niwa.co.nz/)
    
- [New Zealand Institute for Public Health and Forensic Science](https://www.esr.cri.nz/)
    

## Canada

- [Innovation, Science and Economic Development Canada](https://ised-isde.canada.ca/)
    
- [National Research Council Canada](https://nrc.canada.ca/en)
    
- [Natural Sciences and Engineering Research Council](https://www.nserc-crsng.gc.ca/)
    
- [Canadian Institutes of Health Research](https://cihr-irsc.gc.ca/)
    
- [Natural Resources Canada](https://natural-resources.canada.ca/)
    
- [Canadian Nuclear Safety Commission](https://www.cnsc-ccsn.gc.ca/)
    
- [Canadian Nuclear Laboratories](https://www.cnl.ca/)
    
- [Canadian Space Agency](https://www.asc-csa.gc.ca/eng/)
    
- [Environment and Climate Change Canada](https://www.canada.ca/en/environment-climate-change.html)
    

## Brazil

- [Ministry of Science, Technology and Innovation](https://www.gov.br/mcti/pt-br)
    
- [National Council for Scientific and Technological Development](https://www.gov.br/cnpq/pt-br)
    
- [Brazilian Nuclear Energy Commission](https://www.gov.br/cnen/pt-br)
    
- [National Institute for Space Research](https://www.gov.br/inpe/pt-br)
    
- [Brazilian Space Agency](https://www.gov.br/aeb/pt-br)
    
- [Fiocruz](https://portal.fiocruz.br/en)
    
- [Brazilian Center for Research in Energy and Materials](https://cnpem.br/en/)
    

## Argentina

- [National Scientific and Technical Research Council](https://www.conicet.gov.ar/)
    
- [National Atomic Energy Commission](https://www.argentina.gob.ar/cnea)
    
- [National Space Activities Commission](https://www.argentina.gob.ar/ciencia/conae)
    
- [National Institute of Industrial Technology](https://www.inti.gob.ar/)
    
- [National Institute of Agricultural Technology](https://www.argentina.gob.ar/inta)
    

## Israel

- [Ministry of Innovation, Science and Technology](https://www.gov.il/en/departments/ministry_of_science_and_technology/)
    
- [Israel Innovation Authority](https://innovationisrael.org.il/en/)
    
- [Israel Space Agency](https://www.space.gov.il/en)
    
- [Israel Atomic Energy Commission](https://www.gov.il/en/departments/units/atomic_energy_commission/)
    
- [Geological Survey of Israel](https://www.gov.il/en/departments/geological_survey_of_israel/)
    

## United Arab Emirates

- [Advanced Technology Research Council](https://www.atrc.gov.ae/)
    
- [Technology Innovation Institute](https://www.tii.ae/)
    
- [UAE Space Agency](https://space.gov.ae/)
    
- [Mohammed Bin Rashid Space Centre](https://www.mbrsc.ae/)
    
- [Emirates Nuclear Energy Corporation](https://www.enec.gov.ae/)
    
- [Ministry of Industry and Advanced Technology](https://moiat.gov.ae/en/)
    

## Saudi Arabia

- [King Abdulaziz City for Science and Technology](https://www.kacst.gov.sa/)
    
- [Saudi Space Agency](https://ssa.gov.sa/)
    
- [King Abdullah City for Atomic and Renewable Energy](https://www.kacare.gov.sa/)
    
- [King Abdullah University of Science and Technology](https://www.kaust.edu.sa/)
    
- [Saudi Geological Survey](https://sgs.gov.sa/)
    

## South Africa

- [Department of Science, Technology and Innovation](https://www.dst.gov.za/)
    
- [National Research Foundation](https://www.nrf.ac.za/)
    
- [Council for Scientific and Industrial Research](https://www.csir.co.za/)
    
- [South African Nuclear Energy Corporation](https://www.necsa.co.za/)
    
- [South African National Space Agency](https://www.sansa.org.za/)
    
- [South African Environmental Observation Network](https://www.saeon.ac.za/)
    
- [South African National Biodiversity Institute](https://www.sanbi.org/)
    

## Broader International Science and Technology Trends

- [Nature](https://www.nature.com/)
    
- [Science](https://www.science.org/)
    
- [arXiv](https://arxiv.org/)
    
- [PubMed](https://pubmed.ncbi.nlm.nih.gov/)
    
- [Europe PMC](https://europepmc.org/)
    
- [Crossref](https://www.crossref.org/)
    
- [OpenAlex](https://openalex.org/)
    
- [CORDIS — EU Research Results](https://cordis.europa.eu/)
    
- [OECD Science, Technology and Innovation](https://www.oecd.org/sti/)
    
- [UNESCO Science Reports](https://www.unesco.org/reports/science/)
    
- [World Intellectual Property Organization](https://www.wipo.int/)
    
- [International Energy Agency](https://www.iea.org/)
    
- [International Atomic Energy Agency](https://www.iaea.org/)
    
- [International Renewable Energy Agency](https://www.irena.org/)
    
- [European Organization for Nuclear Research — CERN](https://home.cern/)
    
- [European Space Agency](https://www.esa.int/)
    
- [European Southern Observatory](https://www.eso.org/)
    
- [International Astronomical Union](https://www.iau.org/)
    
- [International Union of Pure and Applied Physics](https://iupap.org/)
    
- [International Union of Pure and Applied Chemistry](https://iupac.org/)
    
- [International Union of Biological Sciences](https://iubs.org/)
    
- [Global Biodiversity Information Facility](https://www.gbif.org/)
    
- [World Meteorological Organization](https://wmo.int/)
    
- [Intergovernmental Panel on Climate Change](https://www.ipcc.ch/)
    
- [ITER](https://www.iter.org/)
    
- [Square Kilometre Array Observatory](https://www.skao.int/)



## Underwater, Ocean and Seabed Activity

### United Kingdom

- [National Oceanography Centre](https://noc.ac.uk/)
    
- [British Oceanographic Data Centre](https://www.bodc.ac.uk/)
    
- [UK Hydrographic Office](https://www.admiralty.co.uk/)
    
- [Marine Management Organisation](https://www.gov.uk/government/organisations/marine-management-organisation)
    

### France

- [French Institute for Ocean Science — Ifremer](https://www.ifremer.fr/en)
    
- [French Hydrographic and Oceanographic Service](https://www.shom.fr/)
    
- [Coriolis Ocean Data Centre](https://www.coriolis.eu.org/)
    

### Germany

- [GEOMAR Helmholtz Centre for Ocean Research](https://www.geomar.de/en/)
    
- [Federal Maritime and Hydrographic Agency](https://www.bsh.de/EN/)
    
- [Alfred Wegener Institute](https://www.awi.de/en/)
    

### Italy and Spain

- [Italy National Institute of Oceanography and Applied Geophysics](https://www.ogs.it/en)
    
- [Italian Hydrographic Institute](https://www.marina.difesa.it/noi-siamo-la-marina/pilastro-logistico-scientifico/istituto-idrografico/)
    
- [Spanish Institute of Oceanography](https://www.ieo.es/)
    
- [Spanish Hydrographic Institute](https://armada.defensa.gob.es/ArmadaPortal/page/Portal/ArmadaEspannola/cienciaihm/)
    

### Nordic Countries

- [Norwegian Institute of Marine Research](https://www.hi.no/en)
    
- [Norwegian Offshore Directorate](https://www.sodir.no/en/)
    
- [Norwegian Mapping Authority — Nautical Charts](https://www.kartverket.no/en/at-sea)
    
- [Swedish Meteorological and Hydrological Institute](https://www.smhi.se/en)
    
- [Geological Survey of Finland — Marine Geology](https://www.gtk.fi/en/)
    
- [Danish Hydrographic Office](https://eng.gst.dk/)
    

### Japan

- [Japan Agency for Marine-Earth Science and Technology](https://www.jamstec.go.jp/e/)
    
- [Japan Coast Guard Hydrographic and Oceanographic Department](https://www1.kaiho.mlit.go.jp/e/)
    
- [Japan Oceanographic Data Center](https://www.jodc.go.jp/jodcweb/index.html)
    

### China

- [Institute of Oceanology, Chinese Academy of Sciences](https://english.qdio.cas.cn/)
    
- [National Marine Data and Information Service](https://www.nmdis.org.cn/)
    
- [China Argo Real-Time Data Center](http://www.argo.org.cn/)
    

### India

- [Indian National Centre for Ocean Information Services](https://incois.gov.in/)
    
- [National Institute of Ocean Technology](https://www.niot.res.in/)
    
- [National Centre for Polar and Ocean Research](https://ncpor.res.in/)
    
- [National Hydrographic Office](https://hydrobharat.gov.in/)
    

### South Korea

- [Korea Institute of Ocean Science and Technology](https://www.kiost.ac.kr/eng/)
    
- [Korea Hydrographic and Oceanographic Agency](https://www.khoa.go.kr/eng/)
    
- [Korea Polar Research Institute](https://www.kopri.re.kr/eng/)
    

### Australia and New Zealand

- [Integrated Marine Observing System](https://imos.org.au/)
    
- [Australian Institute of Marine Science](https://www.aims.gov.au/)
    
- [CSIRO Oceans and Coasts](https://www.csiro.au/en/research/natural-environment/oceans)
    
- [Australian Hydrographic Office](https://www.hydro.gov.au/)
    
- [New Zealand National Institute of Water and Atmospheric Research](https://niwa.co.nz/)
    
- [Toitū Te Whenua Hydrographic Authority](https://www.linz.govt.nz/products-services/maritime-safety)
    

### Canada and Latin America

- [Fisheries and Oceans Canada](https://www.dfo-mpo.gc.ca/)
    
- [Ocean Networks Canada](https://www.oceannetworks.ca/)
    
- [Canadian Hydrographic Service](https://www.charts.gc.ca/)
    
- [Brazil Interministerial Commission for Sea Resources](https://www.marinha.mil.br/secirm/)
    
- [Chile Hydrographic and Oceanographic Service](https://www.shoa.cl/)
    
- [Argentina Naval Hydrographic Service](https://www.hidro.gov.ar/)
    

### International Ocean Sources

- [International Seabed Authority](https://isa.org.jm/)
    
- [UNESCO Intergovernmental Oceanographic Commission](https://www.ioc.unesco.org/)
    
- [International Hydrographic Organization](https://iho.int/)
    
- [Global Ocean Observing System](https://goosocean.org/)
    
- [Argo Ocean Observing Program](https://argo.ucsd.edu/)
    
- [OceanOPS](https://www.ocean-ops.org/)
    
- [General Bathymetric Chart of the Oceans](https://www.gebco.net/)
    
- [European Marine Observation and Data Network](https://emodnet.ec.europa.eu/)
    
- [Copernicus Marine Service](https://marine.copernicus.eu/)
    
- [International Cable Protection Committee](https://www.iscpc.org/)
    

## Cryptocurrency, Digital Assets and National Currencies

### United Kingdom and Europe

- [Bank of England — Digital Pound](https://www.bankofengland.co.uk/the-digital-pound)
    
- [UK Financial Conduct Authority — Cryptoassets](https://www.fca.org.uk/firms/cryptoassets)
    
- [European Commission — Digital Finance](https://finance.ec.europa.eu/digital-finance_en)
    
- [European Central Bank — Digital Euro](https://www.ecb.europa.eu/euro/digital_euro/)
    
- [European Securities and Markets Authority — MiCA](https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica)
    
- [France Financial Markets Authority — Digital Assets](https://www.amf-france.org/en)
    
- [Germany BaFin — Crypto Assets](https://www.bafin.de/EN/)
    
- [Swiss Financial Market Supervisory Authority — Fintech](https://www.finma.ch/en/authorisation/fintech/)
    

### Asia–Pacific

- [Japan Financial Services Agency — Fintech](https://www.fsa.go.jp/en/)
    
- [Bank of Japan — Central Bank Digital Currency](https://www.boj.or.jp/en/paym/digital/)
    
- [Monetary Authority of Singapore — FinTech](https://www.mas.gov.sg/development/fintech)
    
- [Hong Kong Monetary Authority — Digital Finance](https://www.hkma.gov.hk/eng/key-functions/international-financial-centre/fintech/)
    
- [Hong Kong Securities and Futures Commission](https://www.sfc.hk/en/)
    
- [South Korea Financial Services Commission](https://www.fsc.go.kr/eng/)
    
- [Bank of Korea](https://www.bok.or.kr/eng/)
    
- [Reserve Bank of India](https://www.rbi.org.in/)
    
- [India Financial Intelligence Unit](https://fiuindia.gov.in/)
    
- [People’s Bank of China](http://www.pbc.gov.cn/en/)
    
- [Reserve Bank of Australia — Digital Currency](https://www.rba.gov.au/payments-and-infrastructure/central-bank-digital-currency/)
    
- [Australian Securities and Investments Commission — Crypto Assets](https://asic.gov.au/regulatory-resources/digital-transformation/crypto-assets/)
    

### Middle East

- [UAE Virtual Assets Regulatory Authority](https://www.vara.ae/)
    
- [Central Bank of the UAE](https://www.centralbank.ae/en/)
    
- [Abu Dhabi Global Market Financial Services Regulatory Authority](https://www.adgm.com/financial-services-regulatory-authority)
    
- [Saudi Central Bank](https://www.sama.gov.sa/en-US/)
    
- [Bahrain Central Bank — FinTech](https://www.cbb.gov.bh/fintech/)
    
- [Qatar Central Bank](https://www.qcb.gov.qa/en/)
    
- [Israel Securities Authority](https://www.new.isa.gov.il/en/)
    

### Americas and Africa

- [Bank of Canada — Digital Currencies and Fintech](https://www.bankofcanada.ca/research/digital-currencies-and-fintech/)
    
- [Canadian Securities Administrators — Crypto Assets](https://www.securities-administrators.ca/)
    
- [Central Bank of Brazil](https://www.bcb.gov.br/en)
    
- [Brazil Securities and Exchange Commission](https://www.gov.br/cvm/en)
    
- [Bank of Mexico](https://www.banxico.org.mx/indexen.html)
    
- [Central Bank of Nigeria](https://www.cbn.gov.ng/)
    
- [eNaira](https://enaira.gov.ng/)
    
- [South African Reserve Bank — Fintech](https://www.resbank.co.za/en/home/what-we-do/fintech)
    
- [South Africa Financial Sector Conduct Authority](https://www.fsca.co.za/)
    

### International Digital-Finance Sources

- [BIS Innovation Hub](https://www.bis.org/about/bisih/)
    
- [BIS Central Bank Digital Currency](https://www.bis.org/topic/cbdc.htm)
    
- [Financial Stability Board — Crypto Assets](https://www.fsb.org/work-of-the-fsb/financial-innovation-and-structural-change/crypto-assets/)
    
- [FATF — Virtual Assets](https://www.fatf-gafi.org/en/topics/virtual-assets.html)
    
- [IMF Fintech](https://www.imf.org/en/Topics/fintech)
    
- [Cambridge Digital Assets Programme](https://www.jbs.cam.ac.uk/faculty-research/centres/alternative-finance/)
    
- [Atlantic Council CBDC Tracker](https://www.atlanticcouncil.org/cbdctracker/)
    

## Additional Areas Not Yet Covered

### Climate, Weather and Natural Hazards

- [World Meteorological Organization](https://wmo.int/)
    
- [Copernicus Climate Change Service](https://climate.copernicus.eu/)
    
- [European Centre for Medium-Range Weather Forecasts](https://www.ecmwf.int/)
    
- [Global Disaster Alert and Coordination System](https://www.gdacs.org/)
    
- [International Seismological Centre](https://www.isc.ac.uk/)
    
- [Global Volcanism Program](https://volcano.si.edu/)
    
- [EM-DAT International Disaster Database](https://www.emdat.be/)
    

### Agriculture, Food and Fisheries

- [UN Food and Agriculture Organization](https://www.fao.org/)
    
- [FAOSTAT](https://www.fao.org/faostat/)
    
- [World Food Programme](https://www.wfp.org/)
    
- [International Food Policy Research Institute](https://www.ifpri.org/)
    
- [Global Agriculture and Food Security Program](https://www.gafspfund.org/)
    
- [International Plant Protection Convention](https://www.ippc.int/)
    
- [World Organisation for Animal Health](https://www.woah.org/)
    

### Mining, Minerals and Raw Materials

- [British Geological Survey](https://www.bgs.ac.uk/)
    
- [Geoscience Australia](https://www.ga.gov.au/)
    
- [Geological Survey of Canada](https://natural-resources.canada.ca/science-data/science-research/earth-sciences/geological-survey-canada)
    
- [China Geological Survey](https://en.cgs.gov.cn/)
    
- [Geological Survey of India](https://www.gsi.gov.in/)
    
- [International Energy Agency — Critical Minerals](https://www.iea.org/topics/critical-minerals)
    
- [European Commission Raw Materials Information System](https://rmis.jrc.ec.europa.eu/)
    

### Infrastructure and Construction

- [Global Infrastructure Hub](https://www.gihub.org/)
    
- [World Bank Infrastructure](https://www.worldbank.org/en/topic/infrastructure)
    
- [European Investment Bank](https://www.eib.org/)
    
- [Asian Infrastructure Investment Bank](https://www.aiib.org/)
    
- [Global Infrastructure Facility](https://www.globalinfrafacility.org/)
    
- [International Transport Forum](https://www.itf-oecd.org/)
    

### Transportation, Ports and Logistics

- [International Maritime Organization](https://www.imo.org/)
    
- [International Civil Aviation Organization](https://www.icao.int/)
    
- [International Union of Railways](https://uic.org/)
    
- [UN Trade and Transport Data](https://unctadstat.unctad.org/)
    
- [European Maritime Safety Agency](https://www.emsa.europa.eu/)
    
- [European Union Aviation Safety Agency](https://www.easa.europa.eu/)
    
- [World Customs Organization](https://www.wcoomd.org/)
    

### Telecommunications and Spectrum

- [International Telecommunication Union](https://www.itu.int/)
    
- [European Telecommunications Standards Institute](https://www.etsi.org/)
    
- [GSMA Intelligence](https://www.gsmaintelligence.com/)
    
- [UK Ofcom](https://www.ofcom.org.uk/)
    
- [Germany Federal Network Agency](https://www.bundesnetzagentur.de/EN/)
    
- [Singapore Infocomm Media Development Authority](https://www.imda.gov.sg/)
    

### Patents, Standards and Industrial Innovation

- [World Intellectual Property Organization](https://www.wipo.int/)
    
- [European Patent Office](https://www.epo.org/)
    
- [Japan Patent Office](https://www.jpo.go.jp/e/)
    
- [China National Intellectual Property Administration](https://english.cnipa.gov.cn/)
    
- [Korean Intellectual Property Office](https://www.kipo.go.kr/en/)
    
- [International Organization for Standardization](https://www.iso.org/)
    
- [International Electrotechnical Commission](https://www.iec.ch/)
    
- [IEEE Standards Association](https://standards.ieee.org/)
    

### Cybersecurity and Digital Infrastructure

- [European Union Agency for Cybersecurity](https://www.enisa.europa.eu/)
    
- [UK National Cyber Security Centre](https://www.ncsc.gov.uk/)
    
- [Germany Federal Office for Information Security](https://www.bsi.bund.de/EN/)
    
- [France National Cybersecurity Agency](https://cyber.gouv.fr/en)
    
- [Japan National Center of Incident Readiness and Strategy for Cybersecurity](https://www.nisc.go.jp/eng/)
    
- [Singapore Cyber Security Agency](https://www.csa.gov.sg/)
    
- [Australia Cyber Security Centre](https://www.cyber.gov.au/)
    
- [FIRST Incident Response Network](https://www.first.org/)
    

### Public Procurement and Government Spending

- [United Kingdom Contracts Finder](https://www.contractsfinder.service.gov.uk/)
    
- [European Union Tenders Electronic Daily](https://ted.europa.eu/)
    
- [France Public Procurement Data](https://www.data.gouv.fr/)
    
- [Germany Public Procurement Portal](https://www.service.bund.de/)
    
- [CanadaBuys](https://canadabuys.canada.ca/)
    
- [Australia AusTender](https://www.tenders.gov.au/)
    
- [India Government e-Marketplace](https://gem.gov.in/)
    
- [World Bank Procurement](https://projects.worldbank.org/en/projects-operations/procurement)
    

### Migration, Borders and Demographics

- [International Organization for Migration](https://www.iom.int/)
    
- [Migration Data Portal](https://www.migrationdataportal.org/)
    
- [UN Refugee Agency](https://www.unhcr.org/)
    
- [UN Population Division](https://www.un.org/development/desa/pd/)
    
- [Eurostat Population and Demography](https://ec.europa.eu/eurostat/web/population-demography/)
    
- [OECD Migration](https://www.oecd.org/migration/)
    

### Elections, Governance and Political Institutions

- [International Foundation for Electoral Systems](https://www.ifes.org/)
    
- [International IDEA](https://www.idea.int/)
    
- [European Election Database](https://european-election-database.eu/)
    
- [UK Electoral Commission](https://www.electoralcommission.org.uk/)
    
- [Elections Canada](https://www.elections.ca/)
    
- [Australian Electoral Commission](https://www.aec.gov.au/)
    

### Public Health, Disease and Pharmaceuticals

- [World Health Organization](https://www.who.int/)
    
- [European Centre for Disease Prevention and Control](https://www.ecdc.europa.eu/)
    
- [Africa Centres for Disease Control and Prevention](https://africacdc.org/)
    
- [UK Health Security Agency](https://www.gov.uk/government/organisations/uk-health-security-agency)
    
- [European Medicines Agency](https://www.ema.europa.eu/)
    
- [Japan Pharmaceuticals and Medical Devices Agency](https://www.pmda.go.jp/english/)
    
- [Australian Therapeutic Goods Administration](https://www.tga.gov.au/)
    

### Environment, Pollution and Biodiversity

- [UN Environment Programme](https://www.unep.org/)
    
- [Global Biodiversity Information Facility](https://www.gbif.org/)
    
- [Convention on Biological Diversity](https://www.cbd.int/)
    
- [European Environment Agency](https://www.eea.europa.eu/)
    
- [Global Forest Watch](https://www.globalforestwatch.org/)
    
- [Protected Planet](https://www.protectedplanet.net/)
    
- [Global Carbon Atlas](https://globalcarbonatlas.org/)


---


Harvest's bottleneck is no longer storage. It's acquisition and enrichment.

You already have:

* PostgreSQL working
* ingestion framework
* Cascades workflows
* collection policies
* source registry (~97 sources)
* normalization pipeline
* intelligence schema
* Context Fabric concepts
* AI infrastructure

The missing piece is feeding the system enough high-quality observations. Think of it like this:

```text
Sources
    ↓
Collections
    ↓
Observations
    ↓
Relationships
    ↓
Knowledge
    ↓
Context Fabrics
```

Right now you're mostly missing the second and third layers.

## 1. Increase collection frequency

Instead of running a few collections manually, continuously collect.

For example:

* Breaking news: every 5–15 minutes
* Government RSS: every 15–30 minutes
* Procurement: hourly
* Court opinions: hourly
* SEC filings: hourly
* Maritime/AIS: every 5–10 minutes
* Aviation/ADS-B: every minute (where appropriate)
* Academic papers: daily
* Patents: daily
* Sanctions: hourly
* Weather alerts: every 10–15 minutes

That alone multiplies observations dramatically.

---

## 2. Expand the target registry

Don't think in terms of sources. Think in terms of targets.

Instead of:

```text
RSS Feed
```

collect:

```text
Department of Energy
Department of Defense
Lockheed Martin
SpaceX
NVIDIA
Taiwan Semiconductor
South China Sea
Red Sea
Port of Rotterdam
Russian Navy
```

Each target fans out to multiple sources.

One target might query:

* news
* SEC
* procurement
* court cases
* patents
* sanctions
* GitHub
* social
* regulatory filings

Ten targets become hundreds of observations.

---

## 3. Every collection should hit multiple sources

Instead of:

```text
Target
 ↓
One source
```

do:

```text
Target
 ↓
RSS
 ↓
Government
 ↓
Court
 ↓
Patents
 ↓
News
 ↓
GitHub
 ↓
Regulations
 ↓
Maps
```

Now one collection can produce dozens or hundreds of findings.

---

## 4. Add many more collectors

Your current inventory of 97 sources is good, but there are hundreds of valuable public sources.

Examples:

Government:

* USAspending
* FPDS
* SAM.gov
* BIS
* Treasury sanctions
* Federal Register
* NOAA
* NASA
* FCC
* FTC

Legal:

* PACER
* CourtListener
* state courts
* Supreme Courts worldwide

Technology:

* arXiv
* Crossref
* GitHub
* Hugging Face
* CVE
* NVD
* OpenSSF

Finance:

* SEC
* EDGAR
* Companies House
* OpenCorporates
* GLEIF

Transportation:

* FAA
* AIS
* ports
* rail
* customs

Energy:

* EIA
* IEA
* FERC
* ENTSOG

Geospatial:

* Sentinel
* Landsat
* OpenStreetMap

Every additional collector increases the value of the existing platform because they all feed the same analytical model.

---

## 5. Build relationships automatically

Suppose five articles mention:

```text
Port of Rotterdam
```

Do not store five isolated records.

Create one entity:

```text
Port of Rotterdam
```

Then attach:

* articles
* companies
* ships
* countries
* sanctions
* incidents
* contracts

The database grows in *connections*, not just rows.

---

## 6. Enrich every observation

Each collected record should gain additional structure:

* entities
* locations
* organizations
* countries
* industries
* technologies
* products
* dates
* topics
* keywords
* confidence
* language
* source reliability
* geocodes

One article becomes dozens of searchable facts.

---

## 7. Correlate across domains

This is where Harvest becomes much more valuable.

Example:

```
Government contract
+
Patent
+
GitHub commit
+
Press release
+
Court filing
```

→ one Context Fabric.

Or:

```
Ship
+
Port
+
Weather
+
Insurance
+
Sanctions
```

→ one maritime assessment.

Or:

```
Company
+
Procurement
+
Lobbying
+
Political donations
+
Litigation
```

→ one corporate influence view.

You're multiplying knowledge rather than simply collecting more documents.

---

## 8. Capture changes, not just snapshots

Instead of storing only the latest version, record what changed.

For example:

```
Yesterday:
NVIDIA announced X.

Today:
NVIDIA announced X and Y.

```

Store:

* added facts
* removed facts
* changed facts
* confidence changes

Now Harvest can answer "what changed?" rather than only "what exists?"

---

## 9. Derive new records

A single collected article can produce:

* article
* entities
* organization records
* people
* locations
* timeline events
* claims
* evidence links
* relationships
* topics
* summaries
* alerts
* confidence assessments

One document might generate 50–100 database records.

---

## 10. Think in terms of multiplication

Instead of asking, "How do we collect more data?" ask, "How many useful records can one collection produce?"

For example:

```
1 target
    ↓
10 sources
    ↓
250 articles
    ↓
4,000 extracted entities
    ↓
12,000 relationships
    ↓
900 timeline events
    ↓
600 claims
    ↓
300 evidence bundles
    ↓
80 Context Fabrics
```

The goal isn't millions of raw rows. It's a high ratio of **derived, connected knowledge** from each collection.

In my view, the biggest opportunity for Harvest is to become an **observation multiplier**. Every collection should feed multiple collectors, every observation should be enriched into structured facts, every fact should be connected to others, and every connection should support reusable Context Fabrics. That approach increases analytical value far more than simply adding another hundred sources.

---

## RSS Feed Discovery Results (2026-08-02)

Probed 765 unique domains from the catalog above. **126 domains (16.5%) have working RSS feeds** — 268 total feed URLs across 60 categories.

### Key feeds by category

| Category | Feeds | Notable |
|----------|-------|---------|
| Europe | 32 | gov.uk Atom feeds, judiciary, national stats |
| United Kingdom | 27 | DSIT, UKRI councils, UK Space Agency, UKAEA |
| Broader S&T | 16 | Nature, Crossref, CERN, ESA, ESO, IPCC, ITER |
| Americas | 15 | Bank of Canada, Statistics Canada, Invest Canada |
| South Africa | 11 | CSIR, SANBI, SANSA, SAEON, Necsa |
| International Ocean | 9 | Copernicus Marine, EMODnet, GOOS, ISA, Argo |
| Africa | 16 | Central Bank Kenya, Ghana MoF, Nigeria MoF/MoJ |
| Cryptocurrency | 6 | FSB, BIS, Bank of Canada, Atlantic Council |
| Sanctions & Export | 6 | UK Sanctions List, UK ECJU |
| Nordic Countries | 5 | VTT Finland, IFE Norway, GTK Finland |
| Italy | 5 | CNR, INFN, ASI |
| Spain | 2 | CSIC, CDTI |
| Switzerland | 3 | ETH Domain, PSI, EMPA |
| Legal / Courts | 4 | ICJ, ICC, Permanent Court of Arbitration |
| Climate | 2 | Copernicus C3S, ECMWF |
| Telecom | 3 | ETSI, Germany BNetzA |
| Maritime/Aviation | 3 | ICAO, EUROCONTROL, Paris MoU |

### gov.uk feed pattern

All UK government orgs listed in the catalog can be configured with these Atom feed URLs:
```
https://www.gov.uk/search/news-and-communications.atom
https://www.gov.uk/search/all.atom
https://www.gov.uk/search/transparency-and-freedom-of-information-releases.atom
```

### Remaining gap

639 domains (83.5%) have no discoverable RSS feed at common paths. These would require:
- Web scraping (HTML → structured extraction)
- API endpoints (where available — many Eurostat/WTO/IMF/WB/UN agencies have REST APIs)
- Manual feed curation
- Periodic page-diff monitoring for legislative/regulatory sites
