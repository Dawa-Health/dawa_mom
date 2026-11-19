import 'package:dawa_mom/backend/supabase/supabase_database.dart';
import 'package:flutter_test/flutter_test.dart';

// These tests cover the pure mapping/path/query-building logic. They never
// touch the Supabase client, so no network or Supabase.initialize() is needed.

void main() {
  final db = SupabaseDatabase.instance;

  group('collection <-> table mapping', () {
    test('maps known collections to tables', () {
      expect(db.tableForCollection('user'), 'profiles');
      expect(db.tableForCollection('mother'), 'mothers');
      expect(db.tableForCollection('doctor'), 'doctors');
      expect(db.tableForCollection('clinic'), 'clinics');
      expect(db.tableForCollection('first_encounter'), 'first_encounters');
      expect(db.tableForCollection('encounter'), 'encounters');
      expect(db.tableForCollection('parity'), 'parities');
      expect(db.tableForCollection('weeks_of_pregenancy'), 'pregnancy_weeks');
    });

    test('passes unknown collections through unchanged', () {
      expect(db.tableForCollection('period_tracker_entries'),
          'period_tracker_entries');
    });

    test('reverse-maps tables to collections', () {
      expect(db.collectionForTable('profiles'), 'user');
      expect(db.collectionForTable('mothers'), 'mother');
      expect(db.collectionForTable('pregnancy_weeks'), 'weeks_of_pregenancy');
    });

    test('passes unknown tables through unchanged', () {
      expect(db.collectionForTable('something_else'), 'something_else');
    });
  });

  group('collection() and doc() paths', () {
    test('collection with a simple name', () {
      final c = db.collection('mother');
      expect(c.path, 'mother');
      expect(c.collectionName, 'mother');
      expect(c.parent, isNull);
    });

    test('collection trims leading and trailing slashes', () {
      final c = db.collection('/mother/');
      expect(c.path, 'mother');
      expect(c.collectionName, 'mother');
    });

    test('nested collection uses the last segment as its name', () {
      final c = db.collection('mother/m1/appointments');
      expect(c.path, 'mother/m1/appointments');
      expect(c.collectionName, 'appointments');
    });

    test('doc parses collection and id', () {
      final d = db.doc('mother/m1');
      expect(d.collectionName, 'mother');
      expect(d.id, 'm1');
      expect(d.path, 'mother/m1');
      expect(d.toString(), 'mother/m1');
      expect(d.parent?.path, 'mother');
    });

    test('doc trims slashes', () {
      final d = db.doc('/mother/m1/');
      expect(d.path, 'mother/m1');
    });

    test('doc supports nested paths', () {
      final d = db.doc('mother/m1/appointments/a1');
      expect(d.collectionName, 'appointments');
      expect(d.id, 'a1');
      expect(d.path, 'mother/m1/appointments/a1');
    });

    test('doc with only a collection name throws ArgumentError', () {
      expect(() => db.doc('mother'), throwsArgumentError);
    });

    test('collection.doc(id) uses the given id', () {
      final d = db.collection('mother').doc('abc');
      expect(d.id, 'abc');
      expect(d.path, 'mother/abc');
    });

    test('collection.doc() generates unique UUID v4 ids', () {
      final uuid = RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
      final a = db.collection('mother').doc();
      final b = db.collection('mother').doc();
      expect(a.id, matches(uuid));
      expect(b.id, matches(uuid));
      expect(a.id, isNot(b.id));
    });

    test('document.collection builds a child collection path', () {
      final c = db.doc('mother/m1').collection('notes');
      expect(c.path, 'mother/m1/notes');
      expect(c.collectionName, 'notes');
    });
  });

  group('DocumentReference equality', () {
    test('same collection and id are equal with equal hashCodes', () {
      final a = db.doc('mother/m1');
      final b = db.doc('mother/m1');
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('different id or collection are not equal', () {
      expect(db.doc('mother/m1') == db.doc('mother/m2'), isFalse);
      expect(db.doc('mother/m1') == db.doc('doctor/m1'), isFalse);
    });

    test('is not equal to other types', () {
      // ignore: unrelated_type_equality_checks
      expect(db.doc('mother/m1') == 'mother/m1', isFalse);
    });
  });

  group('rowToLegacyData', () {
    test('user row: maps created_at and fills uid', () {
      final data = db.rowToLegacyData('user', {
        'id': 'u1',
        'created_at': '2026-01-01T00:00:00Z',
        'full_name': 'Rudo',
      });
      expect(data['id'], 'u1');
      expect(data['uid'], 'u1');
      expect(data['full_name'], 'Rudo');
      expect((data['created_time'] as DateTime).toUtc(),
          DateTime.utc(2026, 1, 1));
    });

    test('user row without created_at yields null created_time', () {
      final data = db.rowToLegacyData('user', {'id': 'u1'});
      expect(data['created_time'], isNull);
    });

    test('mother row: renames columns and builds references', () {
      final data = db.rowToLegacyData('mother', {
        'id': 'm1',
        'profile_id': 'u1',
        'date_of_birth': '1995-05-01',
        'legacy_mother_id': 'L1',
        'first_encounter_id': 'fe1',
      });
      final userRef = data['user_Id'] as DocumentReference;
      expect(userRef.collectionName, 'user');
      expect(userRef.id, 'u1');
      final feRef = data['first_encounter_id'] as DocumentReference;
      expect(feRef.collectionName, 'first_encounter');
      expect(feRef.id, 'fe1');
      expect(data['mother_id'], 'L1');
      expect(data['dateOfBirth'], DateTime(1995, 5, 1));
    });

    test('mother row falls back to id when legacy_mother_id is missing', () {
      final data = db.rowToLegacyData('mother', {'id': 'm1'});
      expect(data['mother_id'], 'm1');
      expect(data['user_Id'], isNull);
      expect(data['first_encounter_id'], isNull);
    });

    test('doctor row: legacy ids and clinic name', () {
      final data = db.rowToLegacyData('doctor', {
        'id': 'd1',
        'profile_id': 'u9',
        'legacy_doctor_id': 'D-7',
        'clinic_name_legacy': 'Parirenyatwa',
      });
      expect((data['user_Id'] as DocumentReference).id, 'u9');
      expect(data['doctor_id'], 'D-7');
      expect(data['clinic_name'], 'Parirenyatwa');
    });

    test('doctor row falls back to id for doctor_id', () {
      final data = db.rowToLegacyData('doctor', {'id': 'd1'});
      expect(data['doctor_id'], 'd1');
    });

    test('first_encounter row: mother reference', () {
      final data = db.rowToLegacyData('first_encounter', {
        'id': 'fe1',
        'mother_id': 'm1',
      });
      final ref = data['mother_Id'] as DocumentReference;
      expect(ref.collectionName, 'mother');
      expect(ref.id, 'm1');
    });

    test('encounter row: date, time and references', () {
      final data = db.rowToLegacyData('encounter', {
        'id': 'e1',
        'doctor_id': 'd1',
        'mother_id': 'm1',
        'appointment_date': '2026-03-05',
        'appointment_time': '09:30',
      });
      expect(data['date'], DateTime(2026, 3, 5));
      expect(data['time'], '09:30');
      expect((data['doctor_id'] as DocumentReference).collectionName, 'doctor');
      expect((data['doctor_id'] as DocumentReference).id, 'd1');
      expect((data['mother_id'] as DocumentReference).collectionName, 'mother');
    });

    test('unknown collections pass values through and keep id', () {
      final data = db.rowToLegacyData('misc', {'id': 'x', 'note': 'hello'});
      expect(data, {'id': 'x', 'note': 'hello'});
    });

    test('null values stay null', () {
      final data = db.rowToLegacyData('mother', {
        'id': 'm1',
        'profile_id': null,
        'date_of_birth': null,
      });
      expect(data['user_Id'], isNull);
      expect(data['dateOfBirth'], isNull);
    });

    test('period tracker date fields are parsed', () {
      final data = db.rowToLegacyData('period_tracker_entries', {
        'id': 'p1',
        'entry_date': '2026-02-10',
      });
      expect(data['entry_date'], DateTime(2026, 2, 10));
    });
  });

  group('legacyDataToRow', () {
    test('user: maps uid and created_time', () {
      final row = db.legacyDataToRow('user', {
        'uid': 'u1',
        'created_time': DateTime.utc(2026, 1, 1),
      });
      expect(row, {
        'id': 'u1',
        'created_at': '2026-01-01T00:00:00.000Z',
      });
    });

    test('adds the id argument', () {
      final row = db.legacyDataToRow('misc', {'a': 1}, id: 'abc');
      expect(row, {'id': 'abc', 'a': 1});
    });

    test('mother: reference becomes id and dateOfBirth is date-only', () {
      final row = db.legacyDataToRow('mother', {
        'user_Id': db.doc('user/u1'),
        'dateOfBirth': DateTime(1995, 5, 1),
      });
      expect(row, {'profile_id': 'u1', 'date_of_birth': '1995-05-01'});
    });

    test('encounter date is date-only', () {
      final row = db.legacyDataToRow('encounter', {
        'date': DateTime(2026, 3, 5, 14, 30),
        'time': '14:30',
      });
      expect(row['appointment_date'], '2026-03-05');
      expect(row['appointment_time'], '14:30');
    });

    test('other DateTime values become UTC ISO strings', () {
      final row = db.legacyDataToRow('misc', {'at': DateTime.utc(2026, 1, 2)});
      expect(row['at'], '2026-01-02T00:00:00.000Z');
    });

    test('Timestamp becomes a UTC ISO string', () {
      final row = db.legacyDataToRow(
          'misc', {'at': Timestamp.fromDate(DateTime.utc(2026, 1, 2))});
      expect(row['at'], '2026-01-02T00:00:00.000Z');
    });

    test('GeoPoint becomes a lat/long map', () {
      final row = db.legacyDataToRow('misc', {'loc': const GeoPoint(1.5, -2.5)});
      expect(row['loc'], {'latitude': 1.5, 'longitude': -2.5});
    });

    test('iterables are converted element by element', () {
      final row = db.legacyDataToRow('misc', {
        'ids': [db.doc('user/a'), db.doc('user/b')],
      });
      expect(row['ids'], ['a', 'b']);
    });

    test('maps are converted with string keys', () {
      final row = db.legacyDataToRow('misc', {
        'm': {1: DateTime.utc(2026, 1, 1)},
      });
      expect(row['m'], {'1': '2026-01-01T00:00:00.000Z'});
    });

    test('null values are skipped by default', () {
      final row = db.legacyDataToRow('misc', {'a': null, 'b': 2});
      expect(row, {'b': 2});
    });

    test('null values are kept when includeNulls is true', () {
      final row = db.legacyDataToRow('misc', {'a': null, 'b': 2},
          includeNulls: true);
      expect(row.containsKey('a'), isTrue);
      expect(row['a'], isNull);
      expect(row['b'], 2);
    });

    test('FieldValue.delete sets the column to null', () {
      final row = db.legacyDataToRow('misc', {'name': FieldValue.delete()});
      expect(row.containsKey('name'), isTrue);
      expect(row['name'], isNull);
    });

    test('FieldValue.serverTimestamp writes a current UTC timestamp', () {
      final row =
          db.legacyDataToRow('misc', {'updated_at': FieldValue.serverTimestamp()});
      final written = DateTime.parse(row['updated_at'] as String);
      expect(written.isUtc, isTrue);
      expect(DateTime.now().toUtc().difference(written).inSeconds.abs(),
          lessThan(5));
    });
  });

  group('query builder', () {
    test('where / orderBy / limit return new queries', () {
      final base = db.collection('mother');
      final q = base
          .where('age',
              isEqualTo: 1,
              isNotEqualTo: 2,
              isLessThan: 3,
              isLessThanOrEqualTo: 4,
              isGreaterThan: 5,
              isGreaterThanOrEqualTo: 6,
              arrayContains: 7,
              arrayContainsAny: [8, 9],
              whereIn: [1, 2],
              whereNotIn: [3, 4],
              isNull: true)
          .orderBy('age', descending: true)
          .limit(5);
      expect(q, isA<Query>());
      expect(identical(q, base), isFalse);
      expect(q.toString(), 'SupabaseQuery(mother)');
    });

    test('where accepts a combined Filter', () {
      final q = db.collection('mother').where(Filter.and(
            Filter('a', isEqualTo: 1),
            Filter('b', whereIn: [1, 2]),
          ));
      expect(q.toString(), 'SupabaseQuery(mother)');
    });

    test('Filter builds one filter per provided condition', () {
      expect(Filter('a').filters, isEmpty);
      expect(Filter('a', isEqualTo: 1).filters.length, 1);
      expect(
          Filter('a',
                  isEqualTo: 1,
                  isNotEqualTo: 2,
                  whereIn: [1],
                  whereNotIn: [2],
                  arrayContainsAny: [3])
              .filters
              .length,
          5);
    });

    test('Filter.and concatenates filters', () {
      final f = Filter.and(Filter('a', isEqualTo: 1), Filter('b', isEqualTo: 2));
      expect(f.filters.length, 2);
    });

    test('count() returns an AggregateQuery', () {
      expect(db.collection('mother').count(), isA<AggregateQuery>());
      expect(const AggregateQuerySnapshot(3).count, 3);
    });
  });

  group('small value types', () {
    test('FieldValue flags', () {
      expect(FieldValue.delete().isDelete, isTrue);
      expect(FieldValue.delete().isServerTimestamp, isFalse);
      expect(FieldValue.serverTimestamp().isServerTimestamp, isTrue);
      expect(FieldValue.serverTimestamp().isDelete, isFalse);
    });

    test('SetOptions defaults to merge false', () {
      expect(const SetOptions().merge, isFalse);
      expect(const SetOptions(merge: true).merge, isTrue);
    });

    test('Timestamp round-trips a DateTime', () {
      final dt = DateTime.utc(2026, 5, 6, 7);
      expect(Timestamp.fromDate(dt).toDate(), dt);
    });

    test('GeoPoint stores coordinates', () {
      const g = GeoPoint(-17.8, 31.05);
      expect(g.latitude, -17.8);
      expect(g.longitude, 31.05);
    });

    test('DocumentChangeType has the expected values', () {
      expect(DocumentChangeType.values.length, 3);
    });
  });
}
