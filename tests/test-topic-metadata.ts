import assert from 'node:assert';
import { TopicMetadataService, stripCreatorAttribution } from '../src/server/metadata/TopicMetadataService';

console.log('Testing TopicMetadataService...');

// 1. Skydiving
const sky = TopicMetadataService.generateMetadata({
  rawCaption: 'He Skydived Without A Parachute 😱 | Credit: @zackdfilms',
  shortcode: 'Df22NkrBxal'
});
console.log('Skydiving Title:', sky.title);
console.log('Skydiving Description:\n' + sky.description);
console.log('Skydiving Hashtags:', sky.hashtags);
assert.strictEqual(sky.title, 'He Skydived Without A Parachute 😱');
assert.ok(!sky.title.includes('Credit'));
assert.ok(!sky.title.includes('@zackdfilms'));
assert.ok(!sky.description.includes('Credit'));
assert.ok(!sky.description.includes('@zackdfilms'));
assert.ok(sky.description.includes('#Skydiving'));
assert.ok(sky.description.includes('#Shorts'));
assert.ok(sky.hashtags.length >= 3 && sky.hashtags.length <= 5);

// 2. Tech
const tech = TopicMetadataService.generateMetadata({
  rawCaption: 'New humanoid AI robot demonstrates autonomous coding and hardware assembly 🤖 Credit: @techguru',
  shortcode: 'TechReel123'
});
console.log('\nTech Title:', tech.title);
console.log('Tech Hashtags:', tech.hashtags);
assert.ok(!tech.title.includes('Credit'));
assert.ok(!tech.description.includes('@techguru'));
assert.ok(tech.description.includes('#Technology'));
assert.ok(tech.description.includes('#Shorts'));

// 3. Soccer
const soccer = TopicMetadataService.generateMetadata({
  rawCaption: 'Unbelievable 90th minute free kick goal by Messi in Champions League ⚽ Credits to @futball',
  shortcode: 'GoalReel456'
});
console.log('\nSoccer Title:', soccer.title);
console.log('Soccer Hashtags:', soccer.hashtags);
assert.ok(soccer.description.includes('#Football'));
assert.ok(!soccer.title.includes('Credits to'));

// 4. Science
const sci = TopicMetadataService.generateMetadata({
  rawCaption: 'NASA telescope discovers oldest black hole in the universe 🌌 Original creator: @science_hub',
  shortcode: 'ScienceReel789'
});
console.log('\nScience Title:', sci.title);
console.log('Science Hashtags:', sci.hashtags);
assert.ok(sci.description.includes('#Science'));
assert.ok(!sci.description.includes('@science_hub'));

// 5. Wildlife
const wild = TopicMetadataService.generateMetadata({
  rawCaption: 'Wild lion pride defends their territory against a pack of hyenas in Africa 🦁 @wildlife_geo',
  shortcode: 'LionReel001'
});
console.log('\nWildlife Title:', wild.title);
console.log('Wildlife Hashtags:', wild.hashtags);
assert.ok(wild.description.includes('#Wildlife'));
assert.ok(!wild.description.includes('@wildlife_geo'));

// 6. Deduplication & Hashtag format
for (const res of [sky, tech, soccer, sci, wild]) {
  const lowerTags = res.hashtags.map(t => t.toLowerCase());
  const uniqueTags = new Set(lowerTags);
  assert.strictEqual(lowerTags.length, uniqueTags.size, 'Hashtags must be deduplicated');
  for (const t of res.hashtags) {
    assert.ok(t.startsWith('#'), 'Must start with #');
  }
}

// 7. Strip creator attribution helper
assert.strictEqual(stripCreatorAttribution('Awesome action | Credit: @creator'), 'Awesome action');
assert.strictEqual(stripCreatorAttribution('Awesome action | Credits to @creator'), 'Awesome action');
assert.strictEqual(stripCreatorAttribution('Awesome action | Original creator: @creator'), 'Awesome action');
assert.strictEqual(stripCreatorAttribution('Awesome action | By @creator'), 'Awesome action');
assert.strictEqual(stripCreatorAttribution('Awesome action @creator'), 'Awesome action');

console.log('\n✓ ALL TOPIC METADATA TESTS PASSED SUCCESSFULLY!');
