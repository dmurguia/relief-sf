const { supabase } = require('./_shared');

const categoryFor = (venueType) => ({
  cafe: 'Coffee', supermarket: 'Grocery', department_store: 'Grocery', restaurant: 'Restaurant',
  fast_food: 'Restaurant', toilets: 'Public', library: 'Public', community_centre: 'Public', marketplace: 'Public',
}[venueType] || 'Public');

async function publishResearchLead(lead, operatorApproved = false) {
  const restroomId = `gpt-lead-${lead.id}`;
  const publicRecord = {
    id: restroomId,
    name: lead.name,
    address: lead.address || 'San Francisco',
    neighborhood: 'San Francisco',
    category: categoryFor(lead.venue_type),
    latitude: lead.latitude,
    longitude: lead.longitude,
    hours: 'Check posted hours',
    access: 'Confirm access when you arrive',
    tags: operatorApproved ? ['operator-approved', 'research-lead'] : ['gpt-reviewed', 'source-backed'],
    description: operatorApproved
      ? 'Operator-approved venue lead after GPT source triage. Confirm current restroom access when you arrive.'
      : 'GPT-reviewed public-facility lead sourced from OpenStreetMap. Confirm current access when you arrive.',
    source_url: lead.source_url,
    source_name: operatorApproved ? 'OpenStreetMap · operator-approved research lead' : 'OpenStreetMap · GPT-5.6 reviewed lead',
    source_tier: 'gpt_reviewed_lead',
    verification_status: 'approved',
  };
  await supabase('/rest/v1/restrooms?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(publicRecord) });
  return restroomId;
}

function researchActionLog(proposal, action, metadata = {}) {
  const current = proposal && typeof proposal === 'object' ? proposal : {};
  return {
    ...current,
    operator_action: { action, actor: 'operator', at: new Date().toISOString(), ...metadata },
  };
}

module.exports = { publishResearchLead, researchActionLog };
