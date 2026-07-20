import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
  FlatList,
  Image,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Region } from 'react-native-maps';

import MapCanvas from './src/components/MapCanvas';
import type { MapCanvasHandle } from './src/components/MapCanvas.types';
import { categories, Restroom, sfDefaultRegion } from './src/data/restrooms';
import { placeMapPreview, retrieveBusiness, suggestBusinesses, type PickedPlace, type PlaceSuggestionResult } from './src/lib/mapboxPlaces';
import { fallbackDirectory, loadApprovedRestrooms } from './src/lib/restroomDirectory';
import { submitRestroomUpdate } from './src/lib/submissions';

const metersBetween = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) => {
  const rad = Math.PI / 180;
  const earthRadius = 6_371_000;
  const latDelta = (b.latitude - a.latitude) * rad;
  const longDelta = (b.longitude - a.longitude) * rad;
  const h = Math.sin(latDelta / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(longDelta / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
};

const distanceLabel = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();

const isOpenNow = (restroom: Restroom) => {
  if (restroom.hoursStatus === 'confirm') return false;
  if (restroom.hours === '24 hours') return true;
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  return hour >= restroom.opensAt && hour < restroom.closesAt;
};
const availabilityLabel = (restroom: Restroom) => restroom.hoursStatus === 'confirm' ? 'CONFIRM HOURS' : isOpenNow(restroom) ? 'OPEN NOW' : 'CLOSED NOW';

export default function App() {
  const mapRef = useRef<MapCanvasHandle>(null);
  const [region, setRegion] = useState<Region>(sfDefaultRegion);
  const [directory, setDirectory] = useState<Restroom[]>(fallbackDirectory);
  const [directorySource, setDirectorySource] = useState<'loading' | 'live' | 'fallback'>('loading');
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selected, setSelected] = useState<Restroom | null>(null);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [mainBusinessMatches, setMainBusinessMatches] = useState<PlaceSuggestionResult[]>([]);
  const [searchingMainBusinesses, setSearchingMainBusinesses] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');
  const [openOnly, setOpenOnly] = useState(false);
  const [accessFilter, setAccessFilter] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showContribution, setShowContribution] = useState(false);
  const [contributionRestroom, setContributionRestroom] = useState<Restroom | null>(null);
  const [contribution, setContribution] = useState({ note: '', access: '', photoUri: '', accessChoice: '', features: [] as string[], cleanlinessRating: 0 });
  const [showPlaceSuggestion, setShowPlaceSuggestion] = useState(false);
  const [showCoverageLab, setShowCoverageLab] = useState(false);
  const [coverageScope, setCoverageScope] = useState<'San Francisco' | 'New York' | 'SoMa' | 'Golden Gate Park' | 'Mission'>('San Francisco');
  const [placeSuggestion, setPlaceSuggestion] = useState({ name: '', address: '', category: 'Coffee', note: '', photoUri: '', accessChoice: '', features: [] as string[], cleanlinessRating: 0 });
  const [reviewConfirmation, setReviewConfirmation] = useState<{ placeName: string; photoStatus: 'attached' | 'retry' | 'none' } | null>(null);
  const [businessQuery, setBusinessQuery] = useState('');
  const [businessMatches, setBusinessMatches] = useState<PlaceSuggestionResult[]>([]);
  const [pickedBusiness, setPickedBusiness] = useState<PickedPlace | null>(null);
  const [searchingBusinesses, setSearchingBusinesses] = useState(false);
  const [mapboxSession] = useState(() => `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const openPlaceSuggestion = (initialQuery = '', initialMatches: PlaceSuggestionResult[] = []) => {
    Keyboard.dismiss();
    setSelected(null);
    setPickedBusiness(null);
    setBusinessQuery(initialQuery);
    setBusinessMatches(initialMatches);
    setShowPlaceSuggestion(true);
  };

  const chooseBusiness = async (item: PlaceSuggestionResult) => {
    setSearchingBusinesses(true);
    try {
      const place = await retrieveBusiness(item.id, mapboxSession);
      setPickedBusiness(place);
      setPlaceSuggestion((current) => ({ ...current, name: place.name, address: place.address }));
      setBusinessQuery(item.name);
      setBusinessMatches([]);
    } catch {
      Alert.alert('Place unavailable', 'Try choosing another result.');
    } finally {
      setSearchingBusinesses(false);
    }
  };

  const beginPlaceSuggestion = async (item: PlaceSuggestionResult) => {
    openPlaceSuggestion(item.name, [item]);
    await chooseBusiness(item);
  };

  useEffect(() => {
    loadApprovedRestrooms().then((items) => { setDirectory(items); setDirectorySource(items === fallbackDirectory ? 'fallback' : 'live'); }).catch(() => setDirectorySource('fallback'));
  }, []);

  const sortedRestrooms = useMemo(() => {
    return directory
      .filter((item) => activeCategory === 'All' || item.category === activeCategory)
      .filter((item) => !openOnly || isOpenNow(item))
      .filter((item) => !accessFilter || item.tags.some((tag) => normalizeSearch(tag) === normalizeSearch(accessFilter)) || normalizeSearch(item.access).includes(normalizeSearch(accessFilter)))
      .filter((item) => !query.trim() || normalizeSearch(`${item.name} ${item.neighborhood} ${item.address}`).includes(normalizeSearch(query)))
      .sort((a, b) => {
        const origin = userLocation ?? { latitude: region.latitude, longitude: region.longitude };
        return metersBetween(origin, a) - metersBetween(origin, b);
      });
  }, [accessFilter, activeCategory, directory, openOnly, query, region.latitude, region.longitude, userLocation]);

  const focus = useCallback((restroom: Restroom) => {
    mapRef.current?.animateToRegion({ ...restroom, latitudeDelta: 0.012, longitudeDelta: 0.012 });
    setSelected(restroom);
  }, []);

  useEffect(() => {
    if (!showPlaceSuggestion || businessQuery.trim().length < 2 || pickedBusiness) { setBusinessMatches([]); return; }
    const timeout = setTimeout(async () => {
      setSearchingBusinesses(true);
      try { setBusinessMatches(await suggestBusinesses(businessQuery, mapboxSession)); } catch { setBusinessMatches([]); } finally { setSearchingBusinesses(false); }
    }, 280);
    return () => clearTimeout(timeout);
  }, [businessQuery, mapboxSession, pickedBusiness, showPlaceSuggestion]);

  useEffect(() => {
    if (!searchFocused || query.trim().length < 2) { setMainBusinessMatches([]); return; }
    let current = true;
    const timeout = setTimeout(async () => {
      setSearchingMainBusinesses(true);
      try {
        const matches = await suggestBusinesses(query, mapboxSession);
        if (current) setMainBusinessMatches(matches);
      } catch {
        if (current) setMainBusinessMatches([]);
      } finally {
        if (current) setSearchingMainBusinesses(false);
      }
    }, 220);
    return () => { current = false; clearTimeout(timeout); };
  }, [mapboxSession, query, searchFocused]);

  const useMyLocation = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      Alert.alert('Location is off', 'Search any San Francisco address instead. We only use location while the app is open.');
      return;
    }
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    setUserLocation(next);
    mapRef.current?.animateToRegion({ ...next, latitudeDelta: 0.018, longitudeDelta: 0.018 });
  };

  const findImmediateRelief = async () => {
    let origin = userLocation ?? { latitude: region.latitude, longitude: region.longitude };
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status === 'granted') {
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      origin = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setUserLocation(origin);
    }
    const byDistance = [...directory].sort((a, b) => metersBetween(origin, a) - metersBetween(origin, b));
    const closest = byDistance.find(isOpenNow) ?? byDistance[0];
    if (!closest) {
      Alert.alert('No nearby match', 'Try searching an address or removing a filter.');
      return;
    }
    focus(closest);
  };

  const searchAddress = async () => {
    if (!query.trim()) return;
    Keyboard.dismiss();
    const knownMatch = directory.find((item) => normalizeSearch(`${item.name} ${item.neighborhood} ${item.address}`).includes(normalizeSearch(query)));
    if (knownMatch) {
      setSearchFocused(false);
      focus(knownMatch);
      return;
    }
    try {
      const businesses = await suggestBusinesses(query, mapboxSession);
      if (businesses.length) {
        setMainBusinessMatches(businesses);
        setSearchFocused(true);
        return;
      }
      const results = await Location.geocodeAsync(query.toLowerCase().includes('san francisco') ? query : `${query}, San Francisco, CA`);
      if (!results[0]) throw new Error('No location');
      const next = { latitude: results[0].latitude, longitude: results[0].longitude, latitudeDelta: 0.018, longitudeDelta: 0.018 };
      setRegion(next);
      mapRef.current?.animateToRegion(next);
      setSearchFocused(false);
    } catch {
      openPlaceSuggestion(query);
    }
  };

  const sendContribution = async () => {
    if (!contributionRestroom || !contribution.note.trim()) return;
    setSubmitting(true);
    const details = [contribution.access, contribution.accessChoice, ...contribution.features].filter(Boolean).join(' · ');
    const result = await submitRestroomUpdate({ restroomId: contributionRestroom.id, note: contribution.note, accessDetail: details || undefined, cleanlinessRating: contribution.cleanlinessRating || undefined, photoUri: contribution.photoUri || undefined });
    setSubmitting(false);
    setShowContribution(false);
    setContributionRestroom(null);
    setContribution({ note: '', access: '', photoUri: '', accessChoice: '', features: [], cleanlinessRating: 0 });
    Alert.alert(result.remote ? 'Thanks — update submitted' : 'Saved for this demo', result.message);
  };

  const openContribution = (restroom: Restroom) => {
    setContributionRestroom(restroom);
    setSelected(null);
    setTimeout(() => setShowContribution(true), 280);
  };

  const toggleFeature = (feature: string) => setContribution((current) => ({ ...current, features: current.features.includes(feature) ? current.features.filter((item) => item !== feature) : [...current.features, feature] }));

  const choosePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access is off', 'Allow photo access to attach a restroom-only photo for review.');
      return;
    }
    const selection = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.78, allowsEditing: false });
    if (!selection.canceled) {
      const photoUri = await normalizePhotoForUpload(selection.assets[0].uri);
      setContribution((current) => ({ ...current, photoUri }));
    }
  };

  const choosePlacePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access is off', 'Allow photo access to attach a restroom-only photo for review.');
      return;
    }
    const selection = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.78, allowsEditing: false });
    if (!selection.canceled) {
      const photoUri = await normalizePhotoForUpload(selection.assets[0].uri);
      setPlaceSuggestion((current) => ({ ...current, photoUri }));
    }
  };

  const sendPlaceSuggestion = async () => {
    if (!placeSuggestion.name.trim() || !pickedBusiness) return;
    setSubmitting(true);
    try {
      const { submitPlaceSuggestion } = await import('./src/lib/submissions');
      const details = [placeSuggestion.accessChoice, ...placeSuggestion.features].filter(Boolean).join(' · ');
      const result = await submitPlaceSuggestion({ ...placeSuggestion, accessDetail: details || undefined, cleanlinessRating: placeSuggestion.cleanlinessRating || undefined, latitude: pickedBusiness.latitude, longitude: pickedBusiness.longitude });
      if (!result.remote) {
        Alert.alert('Suggestion not submitted', result.message);
        return;
      }
      const placeName = placeSuggestion.name;
      const photoStatus: 'attached' | 'retry' | 'none' = placeSuggestion.photoUri ? (result.message.includes('photo could not') ? 'retry' : 'attached') : 'none';
      setShowPlaceSuggestion(false);
      setPlaceSuggestion({ name: '', address: '', category: 'Coffee', note: '', photoUri: '', accessChoice: '', features: [], cleanlinessRating: 0 });
      setBusinessQuery(''); setPickedBusiness(null); setBusinessMatches([]);
      setQuery(''); setSearchFocused(false); setMainBusinessMatches([]);
      setReviewConfirmation({ placeName, photoStatus });
    } catch {
      Alert.alert('Suggestion not submitted', 'We could not reach the review queue. Nothing was added—please try again in a moment.');
    } finally { setSubmitting(false); }
  };

  const origin = userLocation ?? { latitude: region.latitude, longitude: region.longitude };
  const localSearchMatches = useMemo(() => directory.filter((item) => query.trim().length >= 2 && normalizeSearch(`${item.name} ${item.neighborhood} ${item.address}`).includes(normalizeSearch(query))).slice(0, 3), [directory, query]);
  const showSearchSuggestions = searchFocused && query.trim().length >= 2;

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.mapWrap}><MapCanvas ref={mapRef} restrooms={directory} onSelect={focus} /></View>

      <View style={styles.topPanel}>
        <View style={styles.brandRow}><View><Text style={styles.wordmark}>RELIEF</Text><Text style={styles.tagline}>San Francisco restroom finder</Text></View><Pressable accessibilityLabel="Open settings" onPress={() => setShowCoverageLab(true)} style={styles.settingsButton}><Text style={styles.settingsButtonText}>⚙</Text></Pressable></View>
        <View style={styles.searchRow}>
          <TextInput value={query} onChangeText={setQuery} onFocus={() => setSearchFocused(true)} onSubmitEditing={searchAddress} placeholder="Search restrooms, parks & places" placeholderTextColor="#8A918B" selectionColor="#C95B34" style={[styles.searchInput, Platform.OS === 'web' && ({ outlineStyle: 'none', outlineWidth: 0 } as any)]} returnKeyType="search" />
          <Pressable onPress={searchAddress} style={styles.searchButton}><Text style={styles.searchButtonText}>Go</Text></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {categories.map((category) => <Pressable key={category} onPress={() => setActiveCategory(category)} style={[styles.chip, activeCategory === category && styles.chipActive]}><Text style={[styles.chipText, activeCategory === category && styles.chipTextActive]}>{category}</Text></Pressable>)}
          <Pressable onPress={() => setOpenOnly(!openOnly)} style={[styles.chip, openOnly && styles.chipOpen]}><Text style={[styles.chipText, openOnly && styles.chipTextActive]}>Open now</Text></Pressable>
          {['Free', 'accessible', 'ask first', 'indoor'].map((filter) => <Pressable key={filter} onPress={() => setAccessFilter(accessFilter === filter ? null : filter)} style={[styles.chip, accessFilter === filter && styles.chipActive]}><Text style={[styles.chipText, accessFilter === filter && styles.chipTextActive]}>{filter === 'ask first' ? 'Ask staff' : filter[0].toUpperCase() + filter.slice(1)}</Text></Pressable>)}
        </ScrollView>
      </View>

      {showSearchSuggestions && <View style={styles.searchSuggestions}>
        {localSearchMatches.map((item) => <Pressable key={item.id} onPress={() => { setSearchFocused(false); focus(item); }} style={styles.searchSuggestion}><View style={styles.searchSuggestionMark}><Text style={styles.searchSuggestionMarkText}>✓</Text></View><View><Text style={styles.searchSuggestionTitle}>{item.name}</Text><Text style={styles.searchSuggestionCopy}>{item.address} · In Relief</Text></View></Pressable>)}
        {mainBusinessMatches.map((item) => <Pressable key={item.id} onPress={() => beginPlaceSuggestion(item)} style={styles.searchSuggestion}><View style={[styles.searchSuggestionMark, styles.searchSuggestionExternal]}><Text style={styles.searchSuggestionMarkText}>＋</Text></View><View><Text style={styles.searchSuggestionTitle}>{item.name}</Text><Text style={styles.searchSuggestionCopy}>{item.subtitle} · Add restroom details</Text></View></Pressable>)}
        {searchingMainBusinesses && !mainBusinessMatches.length && !localSearchMatches.length && <View style={styles.searchHint}><Text style={styles.searchHintText}>Finding places in San Francisco…</Text></View>}
        {!searchingMainBusinesses && !mainBusinessMatches.length && !localSearchMatches.length && <Pressable onPress={() => openPlaceSuggestion(query)} style={styles.searchSuggestion}><View style={[styles.searchSuggestionMark, styles.searchSuggestionExternal]}><Text style={styles.searchSuggestionMarkText}>＋</Text></View><View><Text style={styles.searchSuggestionTitle}>Add “{query}” to Relief</Text><Text style={styles.searchSuggestionCopy}>Search a Mapbox place match and send it to review</Text></View></Pressable>}
      </View>}

      <Pressable style={styles.locationButton} onPress={useMyLocation}><Text style={styles.locationButtonText}>⌖</Text></Pressable>
      <Pressable style={styles.luckyButton} onPress={findImmediateRelief}><Text style={styles.luckyLabel}>I’M FEELING LUCKY</Text><Text style={styles.luckyCopy}>Find closest open restroom →</Text></Pressable>

      <View style={styles.resultsPanel}>
        <View style={styles.resultsHeader}><View><Text style={styles.resultsTitle}>{sortedRestrooms.length ? 'Nearby relief' : 'No matches yet'}</Text><Text style={styles.directoryMeta}>{directorySource === 'loading' ? 'Loading verified places…' : directorySource === 'live' ? `${directory.length} map locations · City data + verified community records` : 'Curated fallback directory'}</Text></View>{!sortedRestrooms.length && <Pressable onPress={() => openPlaceSuggestion(query)}><Text style={styles.suggestLink}>Add this place →</Text></Pressable>}</View>
        <FlatList horizontal data={sortedRestrooms.slice(0, 8)} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards} renderItem={({ item }) => <RestroomCard restroom={item} distance={distanceLabel(metersBetween(origin, item))} onPress={() => focus(item)} />} />
      </View>

      <Modal visible={Boolean(selected)} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)} />
        {selected && <View style={styles.detailSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.detailTop}><View><Text style={[styles.categoryPill, { color: selected.color }]}>{selected.category.toUpperCase()}</Text><Text style={styles.detailName}>{selected.name}</Text><Text style={styles.detailAddress}>{selected.address} · {selected.neighborhood}</Text></View><Pressable onPress={() => setSelected(null)}><Text style={styles.close}>×</Text></Pressable></View>
          <View style={styles.statusRow}><Text style={[styles.status, selected.hoursStatus === 'confirm' ? styles.confirm : isOpenNow(selected) ? styles.open : styles.closed]}>{availabilityLabel(selected)}</Text><Text style={styles.hours}>{selected.hours}</Text></View>
          <Text style={styles.description}>{selected.description}</Text>
          <View style={styles.tagRow}>{selected.sourceTier === 'official_city' && <View style={styles.verifiedTag}><Text style={styles.verifiedTagText}>CITY-VERIFIED DATA</Text></View>}{selected.tags.map((tag) => <View key={tag} style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>)}</View>
          <View style={styles.photoNotice}><Text style={styles.photoIcon}>▧</Text><View><Text style={styles.photoTitle}>{selected.photoStatus === 'verified' ? 'Verified restroom photo available' : 'No verified interior photo yet'}</Text><Text style={styles.photoCopy}>{selected.photoStatus === 'verified' ? 'Photo is contributor-licensed and shows the restroom only.' : 'Help the next person: submit a restroom-only photo after your visit.'}</Text></View></View>
          <View style={styles.detailActions}><Pressable style={styles.directions} onPress={() => Linking.openURL(`https://maps.apple.com/?daddr=${selected.latitude},${selected.longitude}`)}><Text style={styles.directionsText}>Directions</Text></Pressable><Pressable style={styles.update} onPress={() => openContribution(selected)}><Text style={styles.updateText}>Update</Text></Pressable></View>
        </View>}
      </Modal>

      <Modal visible={showContribution} animationType="slide" transparent onRequestClose={() => setShowContribution(false)}>
          <View style={styles.contributionSheet}><Text style={styles.contributionTitle}>Keep {contributionRestroom?.name ?? 'this place'} current</Text><Text style={styles.contributionCopy}>Your update is reviewed before it appears. Do not include restroom door codes or people in photos.</Text><TextInput style={styles.noteInput} value={contribution.note} onChangeText={(note) => setContribution((current) => ({ ...current, note }))} placeholder="What changed? E.g. clean, closed, no purchase needed…" placeholderTextColor="#838A83" multiline />
          <Text style={styles.fieldLabel}>ACCESS</Text><View style={styles.optionRow}>{['Free', 'Code required', 'Purchase expected', 'Ask staff'].map((option) => <Pressable key={option} onPress={() => setContribution((current) => ({ ...current, accessChoice: current.accessChoice === option ? '' : option }))} style={[styles.option, contribution.accessChoice === option && styles.optionActive]}><Text style={[styles.optionText, contribution.accessChoice === option && styles.optionTextActive]}>{option}</Text></Pressable>)}</View>
          <Text style={styles.fieldLabel}>RESTROOM DETAILS</Text><View style={styles.optionRow}>{['All-gender', 'Accessible', 'Changing table', 'Clean', 'Needs attention'].map((option) => <Pressable key={option} onPress={() => toggleFeature(option)} style={[styles.option, contribution.features.includes(option) && styles.optionActive]}><Text style={[styles.optionText, contribution.features.includes(option) && styles.optionTextActive]}>{option}</Text></Pressable>)}</View>
          <Text style={styles.fieldLabel}>CLEANLINESS</Text><RatingPicker value={contribution.cleanlinessRating} onChange={(cleanlinessRating) => setContribution((current) => ({ ...current, cleanlinessRating }))} />
          <TextInput style={styles.accessInput} value={contribution.access} onChangeText={(access) => setContribution((current) => ({ ...current, access }))} placeholder="Access detail (optional)" placeholderTextColor="#838A83" />
          <PhotoSelection uri={contribution.photoUri} onChoose={choosePhoto} onRemove={() => setContribution((current) => ({ ...current, photoUri: '' }))} />
          <View style={styles.detailActions}><Pressable style={styles.cancel} onPress={() => { setShowContribution(false); setContributionRestroom(null); }}><Text style={styles.cancelText}>Cancel</Text></Pressable><Pressable style={styles.directions} onPress={sendContribution} disabled={submitting || !contribution.note.trim()}><Text style={styles.directionsText}>{submitting ? 'Sending…' : 'Submit update'}</Text></Pressable></View>
        </View>
      </Modal>
      <Modal visible={showPlaceSuggestion} animationType="slide" transparent onRequestClose={() => setShowPlaceSuggestion(false)}>
        <View style={styles.modalBackdrop} />
        <View style={[styles.contributionSheet, styles.placeSuggestionSheet]}><ScrollView contentContainerStyle={styles.placeSuggestionContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><Text style={styles.contributionTitle}>{pickedBusiness ? 'Add restroom details' : 'Is this place missing?'}</Text><Text style={styles.contributionCopy}>{pickedBusiness ? 'Confirm the location, then share only what you know. It stays pending until reviewed.' : 'Choose the business you meant. We will send it to the human-reviewed queue—no account needed.'}</Text>
          {pickedBusiness ? <View style={styles.pickedBusiness}><View style={styles.pickedBusinessContent}><Text style={styles.pickedBusinessLabel}>MAPBOX PLACE MATCH</Text><Text style={styles.pickedBusinessName}>{pickedBusiness.name}</Text><Text style={styles.pickedBusinessAddress}>{pickedBusiness.address}</Text>{placeMapPreview(pickedBusiness) && <Image source={{ uri: placeMapPreview(pickedBusiness)! }} accessibilityLabel={`Map showing ${pickedBusiness.name}`} style={styles.placePreview} />}</View><Pressable onPress={() => { setPickedBusiness(null); setBusinessQuery(''); setPlaceSuggestion((current) => ({ ...current, name: '', address: '' })); }}><Text style={styles.changePlace}>Change</Text></Pressable></View> : <><TextInput style={styles.accessInput} value={businessQuery} onChangeText={setBusinessQuery} autoCorrect={false} placeholder="Search a business (e.g. Peet’s Coffee)" placeholderTextColor="#838A83" />
          {(searchingBusinesses || businessMatches.length > 0 || businessQuery.trim().length > 1) && <View style={styles.businessResults}>{searchingBusinesses && !businessMatches.length ? <Text style={styles.businessLoading}>Searching San Francisco…</Text> : businessMatches.length ? businessMatches.map((item) => <Pressable key={item.id} onPress={() => chooseBusiness(item)} style={styles.businessResult}><Text style={styles.businessName}>{item.name}</Text><Text style={styles.businessAddress}>{item.subtitle}</Text><Text style={styles.addResultHint}>Not in Relief yet · add details →</Text></Pressable>) : <Text style={styles.businessLoading}>No place match yet. Try a fuller business name or address.</Text>}</View>}</>}
          <Text style={styles.fieldLabel}>PLACE TYPE</Text><View style={styles.optionRow}>{(['Public', 'Park', 'Restaurant', 'Grocery', 'Coffee'] as const).map((category) => <Pressable key={category} onPress={() => setPlaceSuggestion((current) => ({ ...current, category }))} style={[styles.option, placeSuggestion.category === category && styles.optionActive]}><Text style={[styles.optionText, placeSuggestion.category === category && styles.optionTextActive]}>{category}</Text></Pressable>)}</View>
          <Text style={styles.fieldLabel}>ACCESS</Text><View style={styles.optionRow}>{['Free', 'Code required', 'Purchase expected', 'Ask staff'].map((option) => <Pressable key={option} onPress={() => setPlaceSuggestion((current) => ({ ...current, accessChoice: current.accessChoice === option ? '' : option }))} style={[styles.option, placeSuggestion.accessChoice === option && styles.optionActive]}><Text style={[styles.optionText, placeSuggestion.accessChoice === option && styles.optionTextActive]}>{option}</Text></Pressable>)}</View>
          <Text style={styles.fieldLabel}>CLEANLINESS</Text><RatingPicker value={placeSuggestion.cleanlinessRating} onChange={(cleanlinessRating) => setPlaceSuggestion((current) => ({ ...current, cleanlinessRating }))} />
          <TextInput style={styles.noteInput} value={placeSuggestion.note} onChangeText={(note) => setPlaceSuggestion((current) => ({ ...current, note }))} placeholder="Any helpful detail? (optional)" placeholderTextColor="#838A83" multiline />
          <PhotoSelection uri={placeSuggestion.photoUri} onChoose={choosePlacePhoto} onRemove={() => setPlaceSuggestion((current) => ({ ...current, photoUri: '' }))} optional />
          <Text style={styles.photoGuidance}>Only submit photos you took or are allowed to share. No people, business interiors, or door codes.</Text>
          <View style={styles.detailActions}><Pressable style={styles.cancel} onPress={() => { setShowPlaceSuggestion(false); setBusinessQuery(''); setPickedBusiness(null); setBusinessMatches([]); }}><Text style={styles.cancelText}>Cancel</Text></Pressable><Pressable style={styles.directions} onPress={sendPlaceSuggestion} disabled={submitting || !pickedBusiness}><Text style={styles.directionsText}>{submitting ? 'Sending…' : 'Suggest place'}</Text></Pressable></View>
        </ScrollView></View>
      </Modal>
      <Modal visible={Boolean(reviewConfirmation)} animationType="fade" transparent onRequestClose={() => setReviewConfirmation(null)}>
        <View style={styles.confirmationBackdrop}>
          <View style={styles.confirmationCard}>
            <View style={styles.confirmationMark}><Text style={styles.confirmationMarkText}>✓</Text></View>
            <Text style={styles.confirmationEyebrow}>SENT TO REVIEW</Text>
            <Text style={styles.confirmationTitle}>Suggestion received</Text>
            <Text style={styles.confirmationCopy}><Text style={styles.confirmationPlace}>{reviewConfirmation?.placeName}</Text> is now in Relief’s private review queue.</Text>
            <View style={styles.confirmationQueue}>
              <Text style={styles.confirmationQueueLabel}>WHAT HAPPENS NEXT</Text>
              <Text style={styles.confirmationQueueCopy}>We check the restroom details and evidence. It appears on the map only after approval.</Text>
            </View>
            {reviewConfirmation?.photoStatus === 'attached' && <Text style={styles.confirmationPhoto}>Restroom-only photo attached privately for review.</Text>}
            {reviewConfirmation?.photoStatus === 'retry' && <Text style={styles.confirmationPhoto}>The place was sent, but the photo needs to be uploaded again.</Text>}
            <Pressable style={styles.confirmationButton} onPress={() => setReviewConfirmation(null)}><Text style={styles.confirmationButtonText}>Back to map</Text></Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={showCoverageLab} animationType="slide" transparent onRequestClose={() => setShowCoverageLab(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowCoverageLab(false)} />
        <View style={styles.coverageSheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.detailTop}><View><Text style={styles.coverageEyebrow}>OPERATOR SETTINGS</Text><Text style={styles.contributionTitle}>Coverage Lab</Text></View><Pressable onPress={() => setShowCoverageLab(false)}><Text style={styles.close}>×</Text></Pressable></View>
          <Text style={styles.contributionCopy}>Launch the next evidence-backed candidate run. A job can create leads at scale; it can never publish a place automatically.</Text>
          <View style={styles.coverageStats}><View style={styles.coverageStat}><Text style={styles.coverageNumber}>214</Text><Text style={styles.coverageCaption}>SF verified</Text></View><View style={styles.coverageStat}><Text style={styles.coverageNumber}>{coverageScope === 'San Francisco' ? '3,444' : '—'}</Text><Text style={styles.coverageCaption}>{coverageScope === 'San Francisco' ? 'SF candidates' : 'pending queue'}</Text></View><View style={styles.coverageStat}><Text style={styles.coverageNumber}>100%</Text><Text style={styles.coverageCaption}>human-gated</Text></View></View>
          <Text style={styles.fieldLabel}>EXPLORE NEXT</Text>
          <View style={styles.optionRow}>{(['San Francisco', 'New York', 'SoMa', 'Golden Gate Park', 'Mission'] as const).map((scope) => <Pressable key={scope} onPress={() => setCoverageScope(scope)} style={[styles.option, coverageScope === scope && styles.optionActive]}><Text style={[styles.optionText, coverageScope === scope && styles.optionTextActive]}>{scope}</Text></Pressable>)}</View>
          <View style={styles.coverageBrief}><Text style={styles.coverageBriefTitle}>{coverageScope === 'New York' ? 'Queue New York candidate review' : `Explore ${coverageScope}`}</Text><Text style={styles.coverageBriefCopy}>{coverageScope === 'New York' ? 'New York is staged as a city configuration: permitted sources → evidence-backed candidate leads → GPT-5.6 proposed tags → human review. The SF map remains the only active public city until a reviewer approves New York records.' : 'Agents collect only permitted city, open-data, and official-business evidence; deduplicate venue leads; then place them in the private candidate queue for GPT-5.6-assisted extraction and human review.'}</Text><Text style={styles.coverageGuardrail}>Scale candidate review—not unverified public listings.</Text></View>
          <View style={styles.operatorNotice}><Text style={styles.operatorNoticeTitle}>Private operator action required</Text><Text style={styles.operatorNoticeCopy}>For safety, public visitors cannot launch collection jobs. Queue this scope from the protected operator workspace, then review candidates before approval.</Text></View>
          <Pressable style={styles.directions} onPress={() => Alert.alert('Candidate run scoped', `${coverageScope} is prepared for a private evidence-collection and candidate-review run. No locations will be visible in Relief until a human approves them.`)}><Text style={styles.directionsText}>Prepare candidate review brief</Text></Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function RestroomCard({ restroom, distance, onPress }: { restroom: Restroom; distance: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={styles.card}><View style={[styles.cardMark, { backgroundColor: restroom.color }]}><Text style={styles.cardMarkText}>{restroom.category === 'Public' || restroom.category === 'Park' ? 'P' : restroom.category[0]}</Text></View><Text numberOfLines={1} style={styles.cardName}>{restroom.name}</Text><Text numberOfLines={1} style={styles.cardDetail}>{distance} · {restroom.hoursStatus === 'confirm' ? 'Confirm hours' : isOpenNow(restroom) ? 'Open now' : 'Check hours'}</Text><Text numberOfLines={1} style={styles.cardAccess}>{restroom.access}</Text></Pressable>;
}

function RatingPicker({ value, onChange }: { value: number; onChange: (rating: number) => void }) {
  return <View style={styles.ratingRow}>{[1, 2, 3, 4, 5].map((rating) => <Pressable key={rating} accessibilityRole="radio" accessibilityState={{ selected: value === rating }} accessibilityLabel={`${rating} star cleanliness rating`} onPress={() => onChange(value === rating ? 0 : rating)} hitSlop={5}><Text style={[styles.ratingStar, rating <= value && styles.ratingStarSelected]}>★</Text></Pressable>)}<Text style={styles.ratingHint}>{value ? `${value}/5` : 'Optional'}</Text></View>;
}

function PhotoSelection({ uri, onChoose, onRemove, optional = false }: { uri: string; onChoose: () => void; onRemove: () => void; optional?: boolean }) {
  if (!uri) return <Pressable onPress={onChoose} style={styles.photoButton}><Text style={styles.photoButtonText}>{optional ? '+ Add a restroom-only photo (optional)' : '+ Add a restroom-only photo'}</Text></Pressable>;
  return <View style={styles.photoPreviewCard}>
    <Image source={{ uri }} accessibilityLabel="Selected restroom photo preview" style={styles.photoPreviewImage} />
    <View style={styles.photoPreviewContent}><Text style={styles.photoPreviewTitle}>Photo ready to submit</Text><Text style={styles.photoPreviewCopy}>Check that this is the restroom photo you meant to share.</Text><View style={styles.photoPreviewActions}><Pressable accessibilityLabel="Choose a different photo" onPress={onChoose} style={styles.photoChangeButton}><Text style={styles.photoChangeText}>Change</Text></Pressable><Pressable accessibilityLabel="Remove selected photo" onPress={onRemove} style={styles.photoRemoveButton}><Text style={styles.photoRemoveText}>Remove</Text></Pressable></View></View>
  </View>;
}

async function normalizePhotoForUpload(uri: string) {
  try {
    return (await ImageManipulator.manipulateAsync(uri, [], { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG })).uri;
  } catch {
    return uri;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F1EA' },
  mapWrap: { ...StyleSheet.absoluteFill }, topPanel: { paddingHorizontal: 16, paddingTop: 8 }, brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, wordmark: { fontSize: 27, letterSpacing: 4, color: '#173F38', fontWeight: '900' }, tagline: { color: '#53625A', fontSize: 12, letterSpacing: .4, marginTop: -2, marginBottom: 12 }, settingsButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#173F38', alignItems: 'center', justifyContent: 'center', shadowColor: '#182821', shadowOpacity: .17, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }, settingsButtonText: { color: '#FFFEFA', fontSize: 20, lineHeight: 23 },
  searchRow: { backgroundColor: '#FFFEFA', height: 52, borderRadius: 16, shadowColor: '#182821', shadowOpacity: .16, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, flexDirection: 'row', alignItems: 'center', paddingLeft: 15 }, searchInput: { flex: 1, color: '#1B3029', fontSize: 15, minWidth: 84 }, searchButton: { alignSelf: 'stretch', justifyContent: 'center', paddingHorizontal: 17, backgroundColor: '#173F38', borderTopRightRadius: 16, borderBottomRightRadius: 16 }, searchButtonText: { color: '#FCFBF5', fontWeight: '800' }, searchSuggestions: { position: 'absolute', top: 118, left: 16, right: 16, zIndex: 10, backgroundColor: '#FFFEFA', borderRadius: 16, overflow: 'hidden', shadowColor: '#182821', shadowOpacity: .18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, maxHeight: 294 }, searchSuggestion: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomColor: '#E5E8E1', borderBottomWidth: 1 }, searchSuggestionMark: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#173F38', alignItems: 'center', justifyContent: 'center' }, searchSuggestionExternal: { backgroundColor: '#C95B34' }, searchSuggestionMarkText: { color: '#FFFEFA', fontWeight: '900', fontSize: 15 }, searchSuggestionTitle: { color: '#193B32', fontSize: 14, fontWeight: '900' }, searchSuggestionCopy: { color: '#65736B', fontSize: 11, marginTop: 2, maxWidth: 285 }, searchHint: { padding: 14 }, searchHintText: { color: '#5D6D65', fontSize: 13, fontWeight: '700' },
  chips: { gap: 8, paddingTop: 10 }, chip: { backgroundColor: 'rgba(255,254,250,.93)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99 }, chipActive: { backgroundColor: '#173F38' }, chipOpen: { backgroundColor: '#C95B34' }, chipText: { color: '#34483F', fontSize: 12, fontWeight: '700' }, chipTextActive: { color: '#FFFEFA' },
  locationButton: { position: 'absolute', right: 17, top: 203, width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFFEFA', alignItems: 'center', justifyContent: 'center', shadowColor: '#182821', shadowOpacity: .18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }, locationButtonText: { color: '#173F38', fontSize: 27, lineHeight: 30 }, luckyButton: { position: 'absolute', left: 16, top: 204, backgroundColor: '#C95B34', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, shadowColor: '#182821', shadowOpacity: .18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }, luckyLabel: { color: '#FFFEFA', fontSize: 11, letterSpacing: .8, fontWeight: '900' }, luckyCopy: { color: '#FFF0E9', fontSize: 11, marginTop: 2, fontWeight: '700' },
  resultsPanel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#F4F1EA', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 15, paddingBottom: Platform.OS === 'ios' ? 17 : 15 }, resultsHeader: { paddingHorizontal: 18, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }, resultsTitle: { color: '#173F38', fontSize: 19, fontWeight: '900' }, directoryMeta: { color: '#647269', fontSize: 10, marginTop: 2, fontWeight: '700' }, suggestLink: { color: '#C95B34', fontWeight: '900', fontSize: 12 }, cards: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  card: { width: 184, height: 116, borderRadius: 16, padding: 12, backgroundColor: '#FFFEFA', shadowColor: '#1B3029', shadowOpacity: .08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } }, cardMark: { width: 24, height: 24, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 7 }, cardMarkText: { color: '#fff', fontSize: 11, fontWeight: '900' }, cardName: { color: '#1D332B', fontWeight: '800', fontSize: 14 }, cardDetail: { color: '#5C6B63', fontSize: 11, marginTop: 3 }, cardAccess: { color: '#BD532F', fontSize: 11, fontWeight: '700', marginTop: 4 },
  callout: { width: 170, padding: 6 }, calloutTitle: { fontWeight: '800', marginBottom: 2 }, modalBackdrop: { flex: 1, backgroundColor: 'rgba(13,28,23,.25)' }, detailSheet: { backgroundColor: '#FFFEFA', borderTopLeftRadius: 27, borderTopRightRadius: 27, padding: 20, paddingBottom: 34 }, sheetHandle: { width: 40, height: 4, borderRadius: 3, alignSelf: 'center', backgroundColor: '#D5D5CD', marginBottom: 18 }, detailTop: { flexDirection: 'row', justifyContent: 'space-between' }, categoryPill: { fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 5 }, detailName: { color: '#173F38', fontSize: 25, fontWeight: '900', maxWidth: 300 }, detailAddress: { color: '#67736C', marginTop: 4, fontSize: 13 }, close: { color: '#53625A', fontSize: 31, lineHeight: 31 },
  statusRow: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 18 }, status: { fontSize: 11, fontWeight: '900', letterSpacing: .7, paddingVertical: 5, paddingHorizontal: 7, borderRadius: 6, overflow: 'hidden' }, open: { backgroundColor: '#DBEEE0', color: '#21623E' }, closed: { backgroundColor: '#F7DFD5', color: '#963E21' }, confirm: { backgroundColor: '#F4ECD4', color: '#8A651B' }, hours: { color: '#53625A', fontSize: 13 }, description: { color: '#35483F', fontSize: 15, lineHeight: 21, marginTop: 16 }, tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 15 }, tag: { borderColor: '#D7DED7', borderWidth: 1, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 20 }, tagText: { fontSize: 12, color: '#486056', fontWeight: '700' }, verifiedTag: { backgroundColor: '#E1EEE7', paddingHorizontal: 9, paddingVertical: 6, borderRadius: 20 }, verifiedTagText: { fontSize: 10, letterSpacing: .6, color: '#24603D', fontWeight: '900' },
  photoNotice: { flexDirection: 'row', gap: 12, backgroundColor: '#F2F0E8', borderRadius: 14, padding: 12, marginTop: 18 }, photoIcon: { fontSize: 22, color: '#C95B34' }, photoTitle: { color: '#274239', fontWeight: '800', fontSize: 13 }, photoCopy: { color: '#617168', fontSize: 12, lineHeight: 17, marginTop: 2, maxWidth: 290 }, detailActions: { flexDirection: 'row', gap: 10, marginTop: 19 }, directions: { flex: 1, backgroundColor: '#173F38', borderRadius: 13, alignItems: 'center', paddingVertical: 14 }, directionsText: { color: '#FFFDF7', fontWeight: '900', fontSize: 14 }, update: { flex: .65, borderWidth: 1, borderColor: '#173F38', borderRadius: 13, alignItems: 'center', paddingVertical: 14 }, updateText: { color: '#173F38', fontWeight: '900', fontSize: 14 },
  contributionSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFEFA', padding: 23, paddingBottom: 26, borderTopLeftRadius: 27, borderTopRightRadius: 27 }, placeSuggestionSheet: { maxHeight: '90%' }, placeSuggestionContent: { paddingBottom: 12 }, contributionTitle: { color: '#173F38', fontSize: 23, fontWeight: '900' }, contributionCopy: { color: '#5D6D65', lineHeight: 19, marginTop: 6 }, noteInput: { minHeight: 95, borderRadius: 14, backgroundColor: '#F2F0E8', marginTop: 18, padding: 13, color: '#203A31', textAlignVertical: 'top' }, accessInput: { borderRadius: 14, backgroundColor: '#F2F0E8', marginTop: 9, padding: 13, color: '#203A31' }, fieldLabel: { marginTop: 14, color: '#54645B', fontWeight: '900', letterSpacing: 1, fontSize: 10 }, optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 7 }, option: { borderColor: '#C9D2C9', borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 7 }, optionActive: { backgroundColor: '#173F38', borderColor: '#173F38' }, optionText: { color: '#436057', fontWeight: '800', fontSize: 12 }, optionTextActive: { color: '#FFFEFA' }, photoButton: { marginTop: 10, borderRadius: 12, padding: 12, alignItems: 'center', borderColor: '#C9D2C9', borderWidth: 1, borderStyle: 'dashed' }, photoButtonText: { color: '#355448', fontWeight: '800', fontSize: 13 }, photoPreviewCard: { flexDirection: 'row', gap: 11, marginTop: 10, padding: 9, borderRadius: 14, backgroundColor: '#E1EEE7' }, photoPreviewImage: { width: 82, height: 82, borderRadius: 9, backgroundColor: '#C8D3C8' }, photoPreviewContent: { flex: 1, paddingVertical: 1 }, photoPreviewTitle: { color: '#173F38', fontWeight: '900', fontSize: 13 }, photoPreviewCopy: { color: '#536E61', fontSize: 11, lineHeight: 15, marginTop: 3 }, photoPreviewActions: { flexDirection: 'row', gap: 7, marginTop: 8 }, photoChangeButton: { backgroundColor: '#173F38', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9 }, photoChangeText: { color: '#FFFEFA', fontSize: 11, fontWeight: '900' }, photoRemoveButton: { borderColor: '#9D5134', borderWidth: 1, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 }, photoRemoveText: { color: '#9D5134', fontSize: 11, fontWeight: '900' }, photoGuidance: { color: '#6C7B73', fontSize: 11, lineHeight: 16, marginTop: 7 }, cancel: { flex: .7, backgroundColor: '#ECEAE2', borderRadius: 13, alignItems: 'center', paddingVertical: 14 }, cancelText: { color: '#53625A', fontWeight: '800' },
  confirmationBackdrop: { flex: 1, backgroundColor: 'rgba(12, 39, 34, .48)', justifyContent: 'center', alignItems: 'center', padding: 24 }, confirmationCard: { width: '100%', maxWidth: 420, borderRadius: 28, backgroundColor: '#FFFEFA', padding: 28, alignItems: 'center', shadowColor: '#001C17', shadowOpacity: .25, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 8 }, confirmationMark: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#DDEEE5', alignItems: 'center', justifyContent: 'center' }, confirmationMarkText: { color: '#17684B', fontSize: 31, fontWeight: '900' }, confirmationEyebrow: { color: '#C95B34', fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginTop: 17 }, confirmationTitle: { color: '#173F38', fontSize: 27, fontWeight: '900', marginTop: 5 }, confirmationCopy: { color: '#52645B', fontSize: 16, lineHeight: 23, textAlign: 'center', marginTop: 10 }, confirmationPlace: { color: '#173F38', fontWeight: '900' }, confirmationQueue: { width: '100%', borderRadius: 15, backgroundColor: '#EDF4EF', padding: 15, marginTop: 21 }, confirmationQueueLabel: { color: '#61756A', fontSize: 10, fontWeight: '900', letterSpacing: 1.1 }, confirmationQueueCopy: { color: '#315247', fontSize: 13, lineHeight: 18, marginTop: 5 }, confirmationPhoto: { color: '#61756A', fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 13 }, confirmationButton: { width: '100%', backgroundColor: '#173F38', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 22 }, confirmationButtonText: { color: '#FFFEFA', fontSize: 16, fontWeight: '900' },
  pickedBusiness: { marginTop: 10, padding: 13, borderRadius: 14, backgroundColor: '#E1EEE7', flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, pickedBusinessContent: { flex: 1 }, pickedBusinessLabel: { color: '#4D6A5D', fontSize: 9, letterSpacing: 1, fontWeight: '900' }, pickedBusinessName: { color: '#173F38', fontSize: 15, fontWeight: '900', marginTop: 3 }, pickedBusinessAddress: { color: '#53625A', fontSize: 12, marginTop: 2, maxWidth: 245 }, placePreview: { width: '100%', height: 106, borderRadius: 9, marginTop: 10, backgroundColor: '#C8D3C8' }, changePlace: { color: '#C95B34', fontWeight: '900', fontSize: 12, paddingTop: 2 }, businessResults: { backgroundColor: '#FFFEFA', borderColor: '#DDE2DA', borderWidth: 1, borderRadius: 14, marginTop: 6, overflow: 'hidden' }, businessLoading: { padding: 12, color: '#5D6D65', fontSize: 13 }, businessResult: { paddingHorizontal: 13, paddingVertical: 11, borderBottomColor: '#E6E8E1', borderBottomWidth: 1 }, businessName: { color: '#203A31', fontWeight: '800', fontSize: 14 }, businessAddress: { color: '#6B766E', fontSize: 12, marginTop: 2 }, addResultHint: { color: '#C95B34', fontWeight: '800', fontSize: 11, marginTop: 5 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }, ratingStar: { color: '#CED4CE', fontSize: 27, lineHeight: 31 }, ratingStarSelected: { color: '#D49A2A' }, ratingHint: { color: '#657068', fontSize: 12, fontWeight: '800', marginLeft: 7 },
  coverageSheet: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#FFFEFA', padding: 23, paddingBottom: 38, borderTopLeftRadius: 27, borderTopRightRadius: 27 }, coverageEyebrow: { color: '#C95B34', fontSize: 10, letterSpacing: 1.25, fontWeight: '900', marginBottom: 4 }, coverageStats: { flexDirection: 'row', backgroundColor: '#E1EEE7', borderRadius: 15, marginTop: 17, paddingVertical: 13 }, coverageStat: { flex: 1, alignItems: 'center', borderRightWidth: 1, borderRightColor: '#C7D9CF' }, coverageNumber: { color: '#173F38', fontSize: 21, fontWeight: '900' }, coverageCaption: { color: '#567064', fontSize: 10, fontWeight: '700', marginTop: 2 }, coverageBrief: { backgroundColor: '#F2F0E8', borderRadius: 15, padding: 14, marginTop: 14 }, coverageBriefTitle: { color: '#173F38', fontWeight: '900', fontSize: 15 }, coverageBriefCopy: { color: '#4E6057', fontSize: 12, lineHeight: 17, marginTop: 5 }, coverageGuardrail: { color: '#9B4B2A', fontSize: 11, lineHeight: 15, fontWeight: '800', marginTop: 8 }, operatorNotice: { borderLeftWidth: 3, borderLeftColor: '#C95B34', paddingLeft: 10, marginTop: 14 }, operatorNoticeTitle: { color: '#274239', fontSize: 12, fontWeight: '900' }, operatorNoticeCopy: { color: '#637168', fontSize: 11, lineHeight: 16, marginTop: 2 },
});
