'use client';

/**
 * GoogleMapCard Component
 * 
 * Current Status: Uses legacy Google Maps APIs with deprecation warnings
 * 
 * Migration Plan:
 * 1. Replace google.maps.places.PlacesService with new Places API (New)
 * 2. Ensure all markers use google.maps.marker.AdvancedMarkerElement
 * 3. Update to use new place search methods
 * 
 * Deprecation Warnings (Suppressed in Development):
 * - google.maps.Marker (deprecated, using AdvancedMarkerElement when available)
 * - google.maps.places.PlacesService (will be replaced with new Places API)
 * 
 * For production deployment, consider migrating to:
 * - @vis.gl/react-google-maps for better React integration
 * - New Places API (New) for place searches
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPin, Fish, Anchor, Shield, AlertTriangle, Navigation, Star, Loader2 } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { useTheme } from 'next-themes';
import { LoadingSpinner } from './LoadingSpinner';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';

// Dynamically import FishingBorderMonitor to avoid SSR issues
const FishingBorderMonitor = dynamic(
  () => import('./FishingBorderMonitor').then(mod => ({ default: mod.FishingBorderMonitor })),
  { 
    ssr: false,
    loading: () => null
  }
);

import type { FishingBorderAlert } from './FishingBorderMonitor';

interface FishingPOI {
  id: number;
  name: string;
  type: 'fishing_spot' | 'marina' | 'bait_shop' | 'safety_station' | 'port' | 'fishing_charter' | 'boat_ramp';
  lat: number;
  lng: number;
  distance: number;
  description: string;
  rating?: number;
  place_id?: string;
  price_level?: number;
  photos?: string[];
}

interface UserLocation {
  lat: number;
  lng: number;
}

const GoogleMapCard = () => {
  // Hydration fix: Only render after client-side mounting
  const [isMounted, setIsMounted] = useState(false);
  
  const { theme } = useTheme();
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const [userLocation, setUserLocation] = useState<UserLocation | null>(null);
  const [fishingPOIs, setFishingPOIs] = useState<FishingPOI[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGoogleMapsLoaded, setIsGoogleMapsLoaded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [borderAlerts, setBorderAlerts] = useState<FishingBorderAlert[]>([]);
  const [eezBoundary, setEezBoundary] = useState<any>(null);

  // Hydration fix: Set mounted state after component mounts
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    const fetchEezBoundary = async () => {
      try {
        const response = await fetch('https://geo.vliz.be/geoserver/wfs?request=getfeature&service=wfs&version=1.1.0&typename=MarineRegions:eez&outputformat=json&filter=%3CPropertyIsEqualTo%3E%3CPropertyName%3Emrgid%3C%2FPropertyName%3E%3CLiteral%3E8480%3C%2FLiteral%3E%3C%2FPropertyIsEqualTo%3E');
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Validate that we received valid GeoJSON data
        if (data && data.type === 'FeatureCollection' && data.features && data.features.length > 0) {
          setEezBoundary(data);
          console.log('Indian EEZ boundary loaded successfully');
        } else {
          throw new Error('Invalid EEZ boundary data received');
        }
      } catch (error) {
        console.error('Error fetching Indian EEZ boundary:', error);
        // Set boundary to null on error so components can handle gracefully
        setEezBoundary(null);
      }
    };

    fetchEezBoundary();
  }, []);

  // Handle border crossing alerts
  const handleBorderCrossing = (border: FishingBorderAlert) => {
    console.log(`Border crossing detected: ${border.name}`);
    setBorderAlerts(prev => [...prev, border]);
    
    // You can add additional logic here for logging, analytics, etc.
    // For example, save to Firebase or send to analytics service
  };

  // Load Google Maps API with better error handling and async loading
  const loadGoogleMaps = () => {
    // Check if already loaded
    if (window.google && window.google.maps) {
      setIsGoogleMapsLoaded(true);
      return;
    }

    // Check if script is already being loaded
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      // Wait for existing script to load
      const checkLoaded = setInterval(() => {
        if (window.google && window.google.maps) {
          clearInterval(checkLoaded);
          setIsGoogleMapsLoaded(true);
        }
      }, 100);
      return;
    }

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.error('Google Maps API key missing');
      setError('Google Maps API key is not configured. Please add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to your environment variables.');
      setIsLoading(false);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&loading=async`;
    script.async = true;
    script.defer = true;
    
    script.onload = () => {
      // Wait a moment for Google Maps to be fully available
      setTimeout(() => {
        if (window.google && window.google.maps) {
          setIsGoogleMapsLoaded(true);
        } else {
          console.error('Google Maps script loaded but API not available');
          setError('Google Maps loaded but API not available');
          setIsLoading(false);
        }
      }, 100);
    };
    
    script.onerror = (e) => {
      console.error('Google Maps script failed to load:', e);
      if (retryCount < 3) {
        setRetryCount(prev => prev + 1);
        setTimeout(() => loadGoogleMaps(), 2000);
      } else {
        setError('Failed to load Google Maps after 3 attempts. Please check your internet connection and API key.');
        setIsLoading(false);
      }
    };
    
    document.head.appendChild(script);
  };

  useEffect(() => {
    loadGoogleMaps();
    getCurrentLocation();
  }, []);

  useEffect(() => {
    if (isGoogleMapsLoaded && userLocation && mapRef.current && eezBoundary) {
      initializeMap();
    }
  }, [isGoogleMapsLoaded, userLocation, theme, eezBoundary]);

  const getCurrentLocation = () => {
    setIsLoading(true);
    
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser. Using default location (Chennai).');
      const defaultLocation = { lat: 13.0827, lng: 80.2707 };
      setUserLocation(defaultLocation);
      setIsLoading(false);
      toast.error('Geolocation not supported. Using Chennai as default.');
      return;
    }

    // Improved geolocation options
    const options = {
      enableHighAccuracy: true,
      timeout: 15000, // 15 seconds
      maximumAge: 60000 // 1 minute cache
    };
    
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        
        console.log('Geolocation obtained:', location);
        console.log('Accuracy:', position.coords.accuracy, 'meters');
        
        setUserLocation(location);
        
        // Center the map on the actual location
        if (googleMapRef.current) {
          googleMapRef.current.setCenter(location);
          googleMapRef.current.setZoom(12);
        }
        
        setIsLoading(false);
        setError(null);
        toast.success(`Location updated: ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`);
      },
      (error) => {
        console.error('Geolocation error:', error);
        let errorMessage = '';
        const fallbackLocation = { lat: 13.0827, lng: 80.2707 }; // Chennai default
        
        switch(error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = 'Location access denied. Please allow location access and try again.';
            toast.error('Location permission denied. Using Chennai as default.');
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = 'Location information unavailable. Using Chennai as default.';
            toast.error('Location unavailable. Using Chennai as default.');
            break;
          case error.TIMEOUT:
            errorMessage = 'Location request timed out. Using Chennai as default.';
            toast.error('Location timeout. Using Chennai as default.');
            break;
          default:
            errorMessage = 'Unknown location error. Using Chennai as default.';
            toast.error('Location error. Using Chennai as default.');
            break;
        }
        
        setUserLocation(fallbackLocation);
        setError(errorMessage);
        setIsLoading(false);
      },
      options
    );
  };

  const initializeMap = () => {
    if (!mapRef.current || !userLocation || !window.google) {
      console.error('Map initialization failed - missing requirements');
      return;
    }

    // Dark mode map styles
    const darkMapStyles = [
      { elementType: "geometry", stylers: [{ color: "#212121" }] },
      { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
      { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#757575" }] },
      { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
      { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
      { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
      { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
      { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#181818" }] },
      { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
      { featureType: "poi.park", elementType: "labels.text.stroke", stylers: [{ color: "#1b1b1b" }] },
      { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#2c2c2c" }] },
      { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
      { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#373737" }] },
      { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3c3c3c" }] },
      { featureType: "road.highway.controlled_access", elementType: "geometry", stylers: [{ color: "#4e4e4e" }] },
      { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
      { featureType: "transit", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
      { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
      { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3d3d3d" }] }
    ];

    // Light mode map styles  
    const lightMapStyles = [
      { elementType: "geometry", stylers: [{ color: "#f5f5f5" }] },
      { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
      { elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
      { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
      { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
      { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
      { featureType: "poi", elementType: "geometry", stylers: [{ color: "#eeeeee" }] },
      { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
      { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#e5e5e5" }] },
      { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
      { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
      { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
      { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#dadada" }] },
      { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
      { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
      { featureType: "transit.line", elementType: "geometry", stylers: [{ color: "#e5e5e5" }] },
      { featureType: "transit.station", elementType: "geometry", stylers: [{ color: "#eeeeee" }] },
      { featureType: "water", elementType: "geometry", stylers: [{ color: "#c9c9c9" }] },
      { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] }
    ];

    // Initialize Google Map with theme-aware styles and Map ID
    try {
      const mapOptions = {
        center: userLocation,
        zoom: 10, // Good zoom level for location accuracy
        mapTypeId: google.maps.MapTypeId.ROADMAP,
        styles: theme === 'dark' ? darkMapStyles : lightMapStyles,
        disableDefaultUI: false,
        zoomControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        mapTypeControl: true,
        scaleControl: true,
        rotateControl: false,
        // Restrict map to reasonable bounds (optional)
        restriction: {
          latLngBounds: {
            north: 40.0,
            south: 5.0,
            west: 60.0,
            east: 100.0
          },
          strictBounds: false
        }
      };

      const map = new google.maps.Map(mapRef.current, mapOptions);
      googleMapRef.current = map;

      // Add Indian EEZ boundary with proper styling
      if (eezBoundary) {
        try {
          map.data.addGeoJson(eezBoundary);
          map.data.setStyle((feature) => {
            return {
              fillColor: '#FF6B35',
              fillOpacity: 0.1,
              strokeColor: '#FF6B35',
              strokeOpacity: 0.8,
              strokeWeight: 2,
              clickable: true
            };
          });

          // Add info window for EEZ boundary
          map.data.addListener('click', (event) => {
            const feature = event.feature;
            const geoname = feature.getProperty('geoname') || 'Indian Exclusive Economic Zone';
            const territory = feature.getProperty('territory1') || 'India';
            const areaKm2 = feature.getProperty('area_km2');
            
            const infoWindow = new google.maps.InfoWindow({
              content: `
                <div style="padding: 12px; max-width: 300px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
                  <h3 style="margin: 0 0 8px 0; color: #1f2937; font-size: 16px; font-weight: 600;">
                    🌊 ${geoname}
                  </h3>
                  <div style="color: #6b7280; font-size: 14px; line-height: 1.5;">
                    <p style="margin: 4px 0;"><strong>Territory:</strong> ${territory}</p>
                    ${areaKm2 ? `<p style="margin: 4px 0;"><strong>Area:</strong> ${Number(areaKm2).toLocaleString()} km²</p>` : ''}
                    <p style="margin: 8px 0 4px 0; padding: 8px; background: #fef3c7; border-radius: 6px; border-left: 3px solid #f59e0b;">
                      ⚠️ <strong>Fishing Boundary:</strong> Respect maritime boundaries and fishing regulations
                    </p>
                  </div>
                </div>
              `,
              position: event.latLng
            });
            
            infoWindow.open(map);
          });

          console.log('Indian EEZ boundary rendered successfully on map');
        } catch (error) {
          console.error('Error rendering EEZ boundary on map:', error);
        }
      }

      console.log('Map initialized with center:', userLocation);

      // Add user location marker using traditional marker for better compatibility
      const userMarker = new google.maps.Marker({
        position: userLocation,
        map: map,
        title: 'Your Current Location',
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
            <svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="30" cy="30" r="28" fill="rgba(29, 78, 216, 0.2)" stroke="rgba(29, 78, 216, 0.4)" stroke-width="2"/>
              <circle cx="30" cy="30" r="20" fill="#1D4ED8" stroke="#FFFFFF" stroke-width="4"/>
              <circle cx="30" cy="30" r="8" fill="#FFFFFF"/>
            </svg>
          `),
          scaledSize: new google.maps.Size(60, 60),
        },
        animation: google.maps.Animation.DROP,
      });

      // Search for nearby fishing-related places using modern Places API
      try {
        // Note: For production, you should migrate to the new Places API (New)
        // For now, we'll use the legacy API with proper error handling
        const service = new google.maps.places.PlacesService(map);
        searchNearbyFishingPlaces(service, userLocation, map);
      } catch (error) {
        console.error('Error initializing Places service:', error);
        setError('Failed to initialize location services');
      }
    } catch (error) {
      console.error('Error creating Google Map:', error);
      setError('Failed to create map instance: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  // Modern Places API search function
  const searchNearbyFishingPlacesModern = async (location: UserLocation, map: google.maps.Map) => {
    const searches = [
      { keywords: ['fishing', 'marina', 'harbor'], type: 'marina' },
      { keywords: ['fishing', 'pier', 'jetty'], type: 'fishing_spot' },
      { keywords: ['bait', 'tackle', 'fishing', 'shop'], type: 'bait_shop' },
      { keywords: ['coast guard', 'marine safety'], type: 'safety_station' },
      { keywords: ['port', 'harbor', 'dock'], type: 'port' },
      { keywords: ['fishing', 'charter', 'boat tours'], type: 'fishing_charter' },
      { keywords: ['boat', 'ramp', 'launch'], type: 'boat_ramp' }
    ];

    const allPOIs: FishingPOI[] = [];

    try {
      for (const [index, search] of searches.entries()) {
        const request = {
          textQuery: search.keywords.join(' '),
          fields: ['displayName', 'location', 'rating', 'priceLevel', 'photos'],
          locationBias: {
            radius: 25000,
            center: location
          },
          maxResultCount: 3
        };

        // Note: This is a simplified implementation as the new Places API requires different setup
        // For now, we'll fall back to the legacy implementation
        const service = new google.maps.places.PlacesService(map);
        const legacyRequest = {
          location: new google.maps.LatLng(location.lat, location.lng),
          radius: 25000,
          keyword: search.keywords.join(' '),
        };

        service.nearbySearch(legacyRequest, (results, status) => {
          if (status === google.maps.places.PlacesServiceStatus.OK && results) {
            results.slice(0, 3).forEach((place, placeIndex) => {
              if (place.geometry && place.geometry.location) {
                const poi: FishingPOI = {
                  id: index * 10 + placeIndex,
                  name: place.name || 'Unknown Location',
                  type: search.type as any,
                  lat: place.geometry.location.lat(),
                  lng: place.geometry.location.lng(),
                  distance: calculateDistance(location, {
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng()
                  }),
                  description: place.vicinity || 'No description available',
                  rating: place.rating,
                  place_id: place.place_id,
                  price_level: place.price_level,
                  photos: place.photos?.slice(0, 1).map(photo => 
                    photo.getUrl({ maxWidth: 300, maxHeight: 200 })
                  )
                };

                allPOIs.push(poi);
                addModernMarker(poi, map);
              }
            });

            if (index === searches.length - 1) {
              setFishingPOIs(allPOIs.sort((a, b) => a.distance - b.distance));
            }
          }
        });
      }
    } catch (error) {
      console.error('Error with modern Places API:', error);
      // Fallback to legacy implementation
      const service = new google.maps.places.PlacesService(map);
      searchNearbyFishingPlaces(service, location, map);
    }
  };

  // Add marker using modern AdvancedMarkerElement or fallback to legacy
  const addModernMarker = (poi: FishingPOI, map: google.maps.Map) => {
    if (google.maps.marker && google.maps.marker.AdvancedMarkerElement) {
      const markerElement = document.createElement('div');
      markerElement.innerHTML = getMarkerHTML(poi.type);

      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: { lat: poi.lat, lng: poi.lng },
        map: map,
        title: poi.name,
        content: markerElement,
      });

      // Add click listener for info window
      markerElement.addEventListener('click', () => {
        const infoWindow = new google.maps.InfoWindow({
          content: createInfoWindowContent(poi)
        });
        infoWindow.open(map, marker);
      });
    } else {
      // Fallback to legacy marker
      const marker = new google.maps.Marker({
        position: { lat: poi.lat, lng: poi.lng },
        map: map,
        title: poi.name,
        icon: getMarkerIcon(poi.type)
      });

      const infoWindow = new google.maps.InfoWindow({
        content: createInfoWindowContent(poi)
      });

      marker.addListener('click', () => {
        infoWindow.open(map, marker);
      });
    }
  };

  // Get HTML for modern markers
  const getMarkerHTML = (type: string): string => {
    const colors = {
      marina: '#3B82F6',
      fishing_spot: '#10B981',
      bait_shop: '#F59E0B',
      safety_station: '#EF4444',
      port: '#6366F1',
      fishing_charter: '#14B8A6',
      boat_ramp: '#8B5CF6'
    };

    const icons = {
      marina: '⚓',
      fishing_spot: '🐟',
      bait_shop: '🎣',
      safety_station: '🛡️',
      port: '🚢',
      fishing_charter: '🛥️',
      boat_ramp: '🚤'
    };

    return `
      <div style="
        width: 40px;
        height: 40px;
        background: ${colors[type as keyof typeof colors] || '#6B7280'};
        border: 2px solid #FFFFFF;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        cursor: pointer;
      ">${icons[type as keyof typeof icons] || '📍'}</div>
    `;
  };

  const searchNearbyFishingPlaces = (service: google.maps.places.PlacesService, location: UserLocation, map: google.maps.Map) => {
    const searches = [
      // Fishing spots and marinas
      { keyword: 'fishing marina harbor', type: 'marina' },
      { keyword: 'fishing spot pier jetty', type: 'fishing_spot' },
      { keyword: 'bait tackle fishing shop', type: 'bait_shop' },
      { keyword: 'coast guard marine safety', type: 'safety_station' },
      { keyword: 'port harbor dock', type: 'port' },
      { keyword: 'fishing charter boat tours', type: 'fishing_charter' },
      { keyword: 'boat ramp launch', type: 'boat_ramp' }
    ];

    const allPOIs: FishingPOI[] = []; // Initialize empty POIs array
    let searchesCompleted = 0;

    // Add a small delay between searches to be more respectful to the API
    searches.forEach((search, index) => {
      setTimeout(() => {
        const request = {
          location: new google.maps.LatLng(location.lat, location.lng),
          radius: 25000, // 25km radius
          keyword: search.keyword,
        };

        try {
          service.nearbySearch(request, (results, status) => {
            searchesCompleted++;
            
            if (status === google.maps.places.PlacesServiceStatus.OK && results) {
              results.slice(0, 3).forEach((place, placeIndex) => {
                if (place.geometry && place.geometry.location) {
                  const poi: FishingPOI = {
                    id: index * 10 + placeIndex,
                    name: place.name || 'Unknown Location',
                    type: search.type as any,
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng(),
                    distance: calculateDistance(location, {
                      lat: place.geometry.location.lat(),
                      lng: place.geometry.location.lng()
                    }),
                    description: place.vicinity || 'No description available',
                    rating: place.rating,
                    place_id: place.place_id,
                    price_level: place.price_level,
                    photos: place.photos?.slice(0, 1).map(photo => 
                      photo.getUrl({ maxWidth: 300, maxHeight: 200 })
                    )
                  };

                  allPOIs.push(poi);

                  // Add marker to map using modern API when available
                  addModernMarker(poi, map);
                }
              });
            } else if (status !== google.maps.places.PlacesServiceStatus.OK) {
              console.warn(`Places search failed with status: ${status} for ${search.keyword}`);
            }

            // Update state when all searches are complete
            if (searchesCompleted === searches.length) {
              allPOIs.sort((a, b) => a.distance - b.distance);
              setFishingPOIs(allPOIs);
            }
          });
        } catch (error) {
          console.error(`Error searching for ${search.keyword}:`, error);
          searchesCompleted++;
          if (searchesCompleted === searches.length) {
            allPOIs.sort((a, b) => a.distance - b.distance);
            setFishingPOIs(allPOIs);
          }
        }
      }, index * 200); // 200ms delay between searches
    });
  };

  const getMarkerIcon = (type: string) => {
    const colors = {
      fishing_spot: '#3b82f6', // Blue
      marina: '#8b5cf6', // Purple
      bait_shop: '#10b981', // Green
      safety_station: '#ef4444', // Red
      port: '#6366F1', // Indigo
      fishing_charter: '#14B8A6', // Teal
      boat_ramp: '#8B5CF6' // Purple
    };

    const icons = {
      fishing_spot: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', // Simplified fish icon
      marina: 'M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.5L19 8l-7 3.5L5 8l7-3.5zM4 16.5V9l7 3.5v7.5L4 16.5z', // Simplified anchor
      bait_shop: 'M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4H6zm5 14H8v-2h3v2zm0-4H8v-2h3v2zm0-4H8V8h3v2zm5 4h-3v-2h3v2zm0-4h-3v-2h3v2zm0-4h-3V8h3v2z', // Simplified shop
      safety_station: 'M12 2l-9 4.5V12c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V6.5L12 2z', // Shield
      port: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2v-4H6v4zM12 8l6 6H6l6-6z', // Port/dock icon
      fishing_charter: 'M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v-2h2c.96 0 1.88-.28 2.67-.77 1.55-1.01 3.11-1.01 4.66 0 .79.49 1.71.77 2.67.77s1.88-.28 2.67-.77c1.55-1.01 3.11-1.01 4.66 0 .79.49 1.71.77 2.67.77h2v2h-2z', // Boat/charter
      boat_ramp: 'M8.1 13.34l2.83-2.83L3.91 3.5c-.78-.78-.78-2.05 0-2.83.78-.78 2.05-.78 2.83 0l7.01 7.01 2.83-2.83 5.66 5.66-11.31 11.31L8.1 13.34z' // Boat ramp
    };

    return {
      url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
        <svg width="40" height="40" viewBox="0 0 24 24" fill="${colors[type as keyof typeof colors] || '#6b7280'}" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill-opacity="0.8"/>
          <path d="${icons[type as keyof typeof icons] || ''}" fill="white"/>
        </svg>
      `)}`,
      scaledSize: new google.maps.Size(40, 40),
    };
  };

  const createInfoWindowContent = (poi: FishingPOI) => {
    return `
      <div style="max-width: 250px;">
        <h3 style="margin: 0 0 8px 0; font-weight: bold;">${poi.name}</h3>
        <p style="margin: 0 0 8px 0; color: #666; font-size: 14px;">${poi.description}</p>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #888;">
          <span>📍 ${poi.distance.toFixed(1)} km away</span>
          ${poi.rating ? `<span>⭐ ${poi.rating}/5</span>` : ''}
        </div>
        ${poi.photos && poi.photos.length > 0 ? `
          <img src="${poi.photos[0]}" style="width: 100%; height: 120px; object-fit: cover; margin-top: 8px; border-radius: 4px;" alt="${poi.name}">
        ` : ''}
      </div>
    `;
  };

  const calculateDistance = (point1: UserLocation, point2: UserLocation): number => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (point2.lat - point1.lat) * Math.PI / 180;
    const dLng = (point2.lng - point1.lng) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(point1.lat * Math.PI / 180) * Math.cos(point2.lat * Math.PI / 180) * 
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const getIconForPOI = (type: string) => {
    switch (type) {
      case 'fishing_spot':
        return <Fish className="w-5 h-5 text-blue-600" />;
      case 'marina':
        return <Anchor className="w-5 h-5 text-purple-600" />;
      case 'bait_shop':
        return <MapPin className="w-5 h-5 text-green-600" />;
      case 'safety_station':
        return <Shield className="w-5 h-5 text-red-600" />;
      case 'port':
        return <Navigation className="w-5 h-5 text-indigo-600" />;
      case 'fishing_charter':
        return <Anchor className="w-5 h-5 text-teal-600" />;
      case 'boat_ramp':
        return <Navigation className="w-5 h-5 text-violet-600" />;
      default:
        return <MapPin className="w-5 h-5 text-gray-600" />;
    }
  };

  const getColorForPOI = (type: string) => {
    switch (type) {
      case 'fishing_spot':
        return 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400';
      case 'marina':
        return 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-400';
      case 'bait_shop':
        return 'border-green-500 bg-green-50 dark:bg-green-900/20 dark:border-green-400';
      case 'safety_station':
        return 'border-red-500 bg-red-50 dark:bg-red-900/20 dark:border-red-400';
      case 'port':
        return 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-400';
      case 'fishing_charter':
        return 'border-teal-500 bg-teal-50 dark:bg-teal-900/20 dark:border-teal-400';
      case 'boat_ramp':
        return 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 dark:border-violet-400';
      default:
        return 'border-gray-500 bg-gray-50 dark:bg-gray-900/20 dark:border-gray-400';
    }
  };

  const getDirections = (poi: FishingPOI) => {
    if (userLocation) {
      const url = `https://www.google.com/maps/dir/${userLocation.lat},${userLocation.lng}/${poi.lat},${poi.lng}`;
      window.open(url, '_blank');
    }
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full glass-card rounded-2xl">
          <div className="text-center p-8">
            <LoadingSpinner 
              size="lg" 
              text="Loading fishing spots and map data..."
              className="text-blue-600 dark:text-blue-400"
            />
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center justify-center h-full glass-card rounded-2xl">
          <div className="text-center p-8 max-w-md">
            <AlertTriangle className="w-16 h-16 mb-6 mx-auto text-red-600 dark:text-red-400" />
            <h3 className="text-xl font-bold text-foreground mb-4">Map Error</h3>
            <p className="text-sm text-muted-foreground mb-6">{error}</p>
            <div className="space-y-3">
              <button 
                onClick={() => {
                  setError(null);
                  setIsLoading(true);
                  setRetryCount(0);
                  loadGoogleMaps();
                }}
                className="btn-primary w-full"
              >
                Retry Loading Map
              </button>
              {error.includes('API key') && (
                <div className="glass-card-sm p-4 text-left">
                  <h4 className="font-semibold text-foreground mb-2">Setup Instructions:</h4>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Get a Google Maps API key from Google Cloud Console</li>
                    <li>Enable Maps JavaScript API and Places API</li>
                    <li>Add the key to your .env.local file as NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex flex-col h-full">
        {/* Map container */}
        <div ref={mapRef} className="flex-grow rounded-t-2xl min-h-[400px]" />
        
        {/* Fishing Border Monitor */}
        {googleMapRef.current && userLocation && (
          <FishingBorderMonitor 
            map={googleMapRef.current}
            userLocation={userLocation}
            onBorderCrossing={handleBorderCrossing}
            eezBoundary={eezBoundary}
          />
        )}
        
        {/* POI list */}
        <div className="p-6 glass-card-sm rounded-b-2xl h-72 overflow-y-auto">
          <h4 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2 font-claude">
            <Navigation className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            Nearby Fishing Infrastructure
          </h4>
          {fishingPOIs.length > 0 ? (
            <ul className="space-y-3">
              {fishingPOIs.slice(0, 10).map((poi) => (
                <li 
                  key={poi.id} 
                  className={`glass-card-sm p-4 border-l-4 transition-all duration-300 hover:shadow-lg cursor-pointer ${getColorForPOI(poi.type)}`}
                  onClick={() => getDirections(poi)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-white dark:bg-gray-800 shadow-md">
                        {getIconForPOI(poi.type)}
                      </div>
                      <div>
                        <p className="font-semibold text-foreground font-claude">{poi.name}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-xs font-claude">{poi.description}</p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      <p className="text-sm font-bold text-foreground font-claude">{poi.distance.toFixed(1)} km</p>
                      {poi.rating && (
                        <div className="flex items-center justify-end text-xs text-amber-600 dark:text-amber-400 mt-1">
                          <Star className="w-3 h-3 mr-1 fill-current" />
                          <span className="font-semibold font-claude">{poi.rating.toFixed(1)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-center py-8">
              <Fish className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-foreground font-semibold font-claude">No Fishing Infrastructure Found Nearby</p>
              <p className="text-sm text-muted-foreground font-claude">Try zooming out or exploring a different area.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!isMounted) {
    return null; // Prevent hydration mismatch
  }

  return (
    <Card className="modern-card-tall overflow-hidden">
      <CardHeader className="glass-card p-4 border-b border-border">
        <CardTitle className="flex items-center gap-3 text-foreground font-claude">
          <div className="w-10 h-10 glass-card-sm flex items-center justify-center rounded-xl">
            <MapPin className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          Interactive Fishing Map
          {userLocation && (
            <span className="text-xs glass-card-sm px-2 py-1 rounded-full text-green-600 dark:text-green-400 font-claude">
              Live Location
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 h-full">
        {renderContent()}
      </CardContent>
    </Card>
  );
};

export default GoogleMapCard;