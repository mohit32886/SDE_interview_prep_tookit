package com.interviewprep.labs;

import com.interviewprep.labs.jpa.Author;
import com.interviewprep.labs.jpa.AuthorRepository;
import jakarta.persistence.EntityManager;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.TestPropertySource;

import static org.junit.jupiter.api.Assertions.assertEquals;

@DataJpaTest
@TestPropertySource(properties = {
        "spring.jpa.properties.hibernate.generate_statistics=true"
})
class JpaNPlusOneTest {

    @Autowired
    private AuthorRepository authorRepository;

    @Autowired
    private EntityManager entityManager;

    private Statistics stats;

    @BeforeEach
    void setup() {
        authorRepository.deleteAll();
        for (int i = 1; i <= 5; i++) {
            Author a = new Author("Author " + i);
            a.addBook("Book A-" + i);
            a.addBook("Book B-" + i);
            authorRepository.save(a);
        }
        entityManager.flush();
        entityManager.clear();
        stats = entityManager.getEntityManagerFactory()
                .unwrap(SessionFactory.class)
                .getStatistics();
        stats.clear();
    }

    @Test
    void naiveFindAllTriggersNPlusOneQueries() {
        var authors = authorRepository.findAll();
        int totalBooks = authors.stream().mapToInt(a -> a.getBooks().size()).sum();
        assertEquals(10, totalBooks);
        // 1 query for authors + 5 lazy queries for each author's books = 6
        assertEquals(6L, stats.getPrepareStatementCount());
    }

    @Test
    void joinFetchEliminatesNPlusOneToSingleQuery() {
        var authors = authorRepository.findAllWithBooksJoinFetch();
        int totalBooks = authors.stream().mapToInt(a -> a.getBooks().size()).sum();
        assertEquals(10, totalBooks);
        assertEquals(1L, stats.getPrepareStatementCount());
    }

    @Test
    void entityGraphEliminatesNPlusOneToSingleQuery() {
        var authors = authorRepository.findAllWithEntityGraph();
        int totalBooks = authors.stream().mapToInt(a -> a.getBooks().size()).sum();
        assertEquals(10, totalBooks);
        assertEquals(1L, stats.getPrepareStatementCount());
    }
}
