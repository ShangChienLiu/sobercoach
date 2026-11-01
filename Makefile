.PHONY: test test-functions test-sql test-ios serve eval ios-gen

test: test-functions test-sql test-ios

test-functions:
	cd supabase/functions/_shared && deno test .
	cd supabase/functions && deno check --config deno.json chat/index.ts evaluate-triggers/index.ts

test-sql:
	./supabase/tests/run_local.sh

ios-gen:
	cd ios/SoberCoach && xcodegen generate

test-ios: ios-gen
	cd ios/SoberCoach && xcodebuild -project SoberCoach.xcodeproj -scheme SoberCoach \
	  -destination 'platform=iOS Simulator,name=iPhone 17' test | grep -E "error:|Executed|TEST"

serve:
	supabase start && supabase db reset && supabase functions serve --env-file supabase/.env

eval:
	deno run -A eval/run.ts --url $${SUPABASE_URL:-http://127.0.0.1:54321} --anon $$SUPABASE_ANON_KEY --runs 3 --paraphrases --label $${LABEL:-default}

# Bake-off: restart the local functions with a variant env, then run the scenarios.
# usage: make bakeoff ENVFILE=supabase/.env.luna LABEL=luna
bakeoff:
	@test -n "$(ENVFILE)" || (echo "set ENVFILE"; exit 1)
	supabase functions serve --env-file $(ENVFILE) & sleep 8; \
	deno run -A eval/run.ts --url $${SUPABASE_URL:-http://127.0.0.1:54321} --anon $$SUPABASE_ANON_KEY --service $$SUPABASE_SERVICE_ROLE_KEY --runs 3 --paraphrases --label $(LABEL); \
	kill %1

# Voice: run the 35-turn conversation on the hosted stack and score it.
tone:
	deno run -A eval/tone.ts --url $${SUPABASE_URL:?set SUPABASE_URL} --anon $$SUPABASE_ANON_KEY --label $${LABEL:-run}
	OPENROUTER_API_KEY=$$OPENROUTER_API_KEY deno run -A eval/judge.ts "$$(ls -t eval/results/tone-$${LABEL:-run}-*.json | head -1)"
