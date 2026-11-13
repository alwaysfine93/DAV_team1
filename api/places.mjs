// GitHub 위치: api/places.mjs
// Vercel 환경변수: KAKAO_REST_API_KEY
// 사용 예시: /api/places?query=동탄%20공원&page=1
//
// 성공 응답: { ok: true, query, places: [...], meta: {...} }
// 실패 응답: { ok: false, error: "설명" }
//
// 장소 검색 결과만 제공합니다.
// 화면 표시와 추천 기준은 학생이 구현합니다.

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const fail = (status, message) =>
    res.status(status).json({
      ok: false,
      error: message,
    });

  // GET 요청만 허용
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return fail(405, "GET 요청만 사용할 수 있습니다.");
  }

  // 검색어와 페이지 번호 확인
  const params = new URL(
    req.url,
    "https://local.invalid"
  ).searchParams;

  const query = (params.get("query") || "").trim();
  const pageText = params.get("page") || "1";
  const page = Number(pageText);

  if (
    params.getAll("query").length > 1 ||
    !query ||
    query.length > 80
  ) {
    return fail(
      400,
      "query에 1~80자의 검색어를 입력하세요. 예: 동탄 공원"
    );
  }

  if (
    params.getAll("page").length > 1 ||
    !/^\d+$/.test(pageText) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 45
  ) {
    return fail(
      400,
      "page는 1~45 사이의 정수여야 합니다."
    );
  }

  // Vercel 환경변수에서 API 키 읽기
  const key = process.env.KAKAO_REST_API_KEY?.trim();

  if (!key) {
    return fail(
      503,
      "Vercel에 KAKAO_REST_API_KEY를 등록한 뒤 다시 배포하세요."
    );
  }

  // 카카오 장소 검색 요청 주소
  const url = new URL(
    "https://dapi.kakao.com/v2/local/search/keyword.json"
  );

  url.searchParams.set("query", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", "15");

  // 8초 이상 응답이 없으면 요청 중단
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `KakaoAK ${key}`,
      },
      signal: controller.signal,
      redirect: "error",
    });

    // 카카오 API 오류 처리
    if (!response.ok) {
      if (
        response.status === 401 ||
        response.status === 403
      ) {
        return fail(
          502,
          "카카오 인증 또는 사용 권한을 확인하세요. REST API 키와 카카오맵 사용 설정을 확인해야 합니다."
        );
      }

      if (response.status === 429) {
        return fail(
          429,
          "카카오 API 요청 한도에 도달했습니다. 사용량을 확인한 뒤 다시 시도하세요."
        );
      }

      return fail(
        502,
        "카카오 장소 검색 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요."
      );
    }

    const data = await response.json();

    if (
      !Array.isArray(data.documents) ||
      !data.meta ||
      typeof data.meta.is_end !== "boolean"
    ) {
      return fail(
        502,
        "카카오 검색 결과 형식이 올바르지 않습니다."
      );
    }

    // 학생 앱에서 사용하기 쉬운 이름으로 정리
    const places = data.documents.map((p) => ({
      id: p.id,
      name: p.place_name,
      address: p.road_address_name || p.address_name || "",
      roadAddress: p.road_address_name || "",
      category: p.category_name || "",
      latitude: p.y ? Number(p.y) : null,
      longitude: p.x ? Number(p.x) : null,
      mapUrl: p.place_url || "",
    }));

    return res.status(200).json({
      ok: true,
      query,
      places,
      meta: {
        totalCount: data.meta.total_count,
        pageableCount: data.meta.pageable_count,
        isEnd: data.meta.is_end,
        page,
      },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      return fail(
        504,
        "장소 검색 응답이 늦어지고 있습니다. 다시 시도하세요."
      );
    }

    return fail(
      502,
      "장소 검색 서버에 연결할 수 없거나 응답을 읽지 못했습니다."
    );
  } finally {
    clearTimeout(timer);
  }
}
